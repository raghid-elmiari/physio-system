package com.physio.assistant.security;

import java.security.Principal;

/**
 * The authenticated user attached to the SecurityContext by JwtAuthFilter. Implements
 * Principal so Authentication.getName() keeps returning the email, as before.
 */
public record AuthPrincipal(Long userId, String email, String role) implements Principal {
    @Override
    public String getName() {
        return email;
    }

    public boolean isTherapist() {
        return "THERAPIST".equals(role) || "ADMIN".equals(role);
    }
}
