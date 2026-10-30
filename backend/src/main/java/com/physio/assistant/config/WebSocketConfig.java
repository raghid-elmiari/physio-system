package com.physio.assistant.config;

import com.physio.assistant.repository.SessionRepository;
import com.physio.assistant.security.AuthPrincipal;
import com.physio.assistant.security.JwtService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.messaging.MessageChannel;
import org.springframework.messaging.MessageDeliveryException;
import org.springframework.messaging.simp.config.ChannelRegistration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.messaging.simp.stomp.StompCommand;
import org.springframework.messaging.simp.stomp.StompHeaderAccessor;
import org.springframework.messaging.support.ChannelInterceptor;
import org.springframework.messaging.support.MessageHeaderAccessor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Optional push channel used by the edge-device flow: an event ingested via
 * /api/device/sessions/{id}/events is forwarded to /topic/sessions/{sessionId}/feedback.
 * Live feedback for the camera-on-phone/browser flow is computed on-device and does not
 * use this channel.
 *
 * Clients must send "Authorization: Bearer <token>" as a STOMP CONNECT header and may only
 * subscribe to topics of sessions they own.
 */
@Configuration
@EnableWebSocketMessageBroker
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    private static final Pattern SESSION_TOPIC = Pattern.compile("^/topic/sessions/(\\d+)/feedback$");

    private final JwtService jwtService;
    private final SessionRepository sessionRepository;
    private final String[] allowedOrigins;

    public WebSocketConfig(JwtService jwtService, SessionRepository sessionRepository,
                           @Value("${app.cors.allowed-origins}") String allowedOrigins) {
        this.jwtService = jwtService;
        this.sessionRepository = sessionRepository;
        this.allowedOrigins = allowedOrigins.split("\\s*,\\s*");
    }

    @Override
    public void configureMessageBroker(MessageBrokerRegistry registry) {
        registry.enableSimpleBroker("/topic");
        registry.setApplicationDestinationPrefixes("/app");
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        registry.addEndpoint("/ws").setAllowedOriginPatterns(allowedOrigins).withSockJS();
    }

    @Override
    public void configureClientInboundChannel(ChannelRegistration registration) {
        registration.interceptors(new ChannelInterceptor() {
            @Override
            public Message<?> preSend(Message<?> message, MessageChannel channel) {
                StompHeaderAccessor accessor = MessageHeaderAccessor.getAccessor(message, StompHeaderAccessor.class);
                if (accessor == null || accessor.getCommand() == null) return message;

                if (StompCommand.CONNECT.equals(accessor.getCommand())) {
                    String header = accessor.getFirstNativeHeader("Authorization");
                    AuthPrincipal principal = header != null && header.startsWith("Bearer ")
                            ? jwtService.authenticate(header.substring(7)).orElse(null) : null;
                    if (principal == null) throw new MessageDeliveryException("Unauthorized");
                    accessor.setUser(new UsernamePasswordAuthenticationToken(
                            principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + principal.role()))));
                } else if (StompCommand.SUBSCRIBE.equals(accessor.getCommand())) {
                    if (!(accessor.getUser() instanceof UsernamePasswordAuthenticationToken token)
                            || !(token.getPrincipal() instanceof AuthPrincipal principal)) {
                        throw new MessageDeliveryException("Unauthorized");
                    }
                    Matcher m = SESSION_TOPIC.matcher(String.valueOf(accessor.getDestination()));
                    if (!m.matches()) throw new MessageDeliveryException("Unknown destination");
                    long sessionId = Long.parseLong(m.group(1));
                    boolean owns = sessionRepository.findById(sessionId)
                            .map(s -> s.getUser().getId().equals(principal.userId()))
                            .orElse(false);
                    if (!owns) throw new MessageDeliveryException("Forbidden");
                }
                return message;
            }
        });
    }
}
