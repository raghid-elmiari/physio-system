package com.physio.assistant.security;

import com.physio.assistant.exception.ApiException;
import org.springframework.security.core.Authentication;

public final class CurrentUser {
    private CurrentUser() {}

    public static AuthPrincipal of(Authentication auth) {
        if (auth != null && auth.getPrincipal() instanceof AuthPrincipal p) {
            return p;
        }
        throw ApiException.unauthorized("Authentication required");
    }
}
