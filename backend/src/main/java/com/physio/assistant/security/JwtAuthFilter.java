package com.physio.assistant.security;

import com.physio.assistant.entity.User;
import com.physio.assistant.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * Authenticates requests that carry a bearer access token.
 *
 * The token's signature proves who the caller is, but the role and account status are read
 * from the database on every request. A role change or a deactivated account therefore
 * takes effect immediately instead of when the access token expires.
 */
@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    private final JwtService jwtService;
    private final UserRepository userRepository;

    public JwtAuthFilter(JwtService jwtService, UserRepository userRepository) {
        this.jwtService = jwtService;
        this.userRepository = userRepository;
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {

        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")) {
            jwtService.authenticate(header.substring(7))
                    .flatMap(this::withCurrentAccountState)
                    .ifPresent(principal -> {
                        var authToken = new UsernamePasswordAuthenticationToken(
                                principal, null, List.of(new SimpleGrantedAuthority("ROLE_" + principal.role())));
                        SecurityContextHolder.getContext().setAuthentication(authToken);
                    });
            // An invalid/expired token (or a disabled account) is simply not attached to the
            // security context; the request continues unauthenticated and SecurityConfig
            // rejects it with 401 where authentication is required. Public endpoints such as
            // /api/auth/login keep working with a stale header present.
        }
        filterChain.doFilter(request, response);
    }

    /** Empty when the account no longer exists or is disabled; otherwise the principal with the stored role. */
    private Optional<AuthPrincipal> withCurrentAccountState(AuthPrincipal fromToken) {
        return userRepository.findById(fromToken.userId())
                .filter(user -> user.getStatus() == User.Status.ACTIVE)
                .map(user -> new AuthPrincipal(user.getId(), user.getEmail(), user.getRole().name()));
    }
}
