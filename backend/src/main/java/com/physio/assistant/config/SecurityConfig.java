package com.physio.assistant.config;

import com.physio.assistant.security.DeviceApiKeyFilter;
import com.physio.assistant.security.JsonErrorWriter;
import com.physio.assistant.security.JwtAuthFilter;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.Arrays;
import java.util.List;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;
    private final DeviceApiKeyFilter deviceApiKeyFilter;
    private final List<String> allowedOrigins;

    public SecurityConfig(JwtAuthFilter jwtAuthFilter, DeviceApiKeyFilter deviceApiKeyFilter,
                          @Value("${app.cors.allowed-origins}") String allowedOrigins) {
        this.jwtAuthFilter = jwtAuthFilter;
        this.deviceApiKeyFilter = deviceApiKeyFilter;
        this.allowedOrigins = Arrays.stream(allowedOrigins.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable()) // stateless bearer-token auth, no cookies, so CSRF does not apply
            .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .exceptionHandling(ex -> ex
                // 401 (not Spring's default 403) when there is no/invalid token, so clients know to refresh or re-login.
                .authenticationEntryPoint((req, res, e) -> JsonErrorWriter.write(req, res,
                        HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized", "Authentication required"))
                .accessDeniedHandler((req, res, e) -> JsonErrorWriter.write(req, res,
                        HttpServletResponse.SC_FORBIDDEN, "Forbidden", "You do not have permission to perform this action")))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .requestMatchers("/api/auth/**", "/api/health", "/error").permitAll()
                .requestMatchers("/api/device/**").hasRole("DEVICE")
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/therapist/**").hasAnyRole("THERAPIST", "ADMIN")
                // Patient self-service: assessments, performance logging, video suggestions.
                .requestMatchers("/api/patient/**").hasRole("PATIENT")
                .requestMatchers(HttpMethod.GET, "/api/devices").hasAnyRole("THERAPIST", "ADMIN")
                // The SockJS/WebSocket handshake cannot carry an Authorization header; the STOMP
                // CONNECT frame is authenticated instead (WebSocketConfig).
                .requestMatchers("/ws/**").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterBefore(deviceApiKeyFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    // Both filters are @Components, so Boot would also register them as global servlet
    // filters. They must only run inside the security chain above.
    @Bean
    public FilterRegistrationBean<JwtAuthFilter> jwtFilterRegistration(JwtAuthFilter filter) {
        FilterRegistrationBean<JwtAuthFilter> reg = new FilterRegistrationBean<>(filter);
        reg.setEnabled(false);
        return reg;
    }

    @Bean
    public FilterRegistrationBean<DeviceApiKeyFilter> deviceFilterRegistration(DeviceApiKeyFilter filter) {
        FilterRegistrationBean<DeviceApiKeyFilter> reg = new FilterRegistrationBean<>(filter);
        reg.setEnabled(false);
        return reg;
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        // Explicit origin list from app.cors.allowed-origins (CORS_ALLOWED_ORIGINS), never "*".
        configuration.setAllowedOriginPatterns(allowedOrigins);
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Device-Id", "X-Api-Key"));
        configuration.setAllowCredentials(false); // bearer tokens, not cookies
        configuration.setMaxAge(3600L);
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
