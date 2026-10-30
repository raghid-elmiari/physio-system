package com.physio.assistant.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.Optional;

@Service
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private static final int MIN_SECRET_BYTES = 32; // HS256 requires a >= 256-bit key

    private final SecretKey key;
    private final long accessTokenMillis;

    public JwtService(
            @Value("${app.jwt.secret}") String secret,
            @Value("${app.jwt.access-token-minutes}") long accessTokenMinutes
    ) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < MIN_SECRET_BYTES) {
            throw new IllegalStateException("JWT_SECRET is missing or shorter than " + MIN_SECRET_BYTES
                    + " bytes. Set it in backend/.env (see backend/.env.example) or as an environment variable.");
        }
        if (secret.toLowerCase().contains("dev-only")) {
            log.warn("Using the development JWT secret from .env.example. Generate a real one before deploying.");
        }
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.accessTokenMillis = accessTokenMinutes * 60 * 1000;
    }

    public long getAccessTokenSeconds() {
        return accessTokenMillis / 1000;
    }

    public String generateAccessToken(Long userId, String email, String role) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + accessTokenMillis);
        return Jwts.builder()
                .subject(email)
                .claim("userId", userId)
                .claim("role", role)
                .issuedAt(now)
                .expiration(expiry)
                .signWith(key)
                .compact();
    }

    public Claims parseClaims(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }

    /** Returns the principal for a valid, unexpired token; empty for anything else. */
    public Optional<AuthPrincipal> authenticate(String token) {
        try {
            Claims claims = parseClaims(token);
            Number userId = claims.get("userId", Number.class);
            String role = claims.get("role", String.class);
            if (userId == null || role == null) return Optional.empty();
            return Optional.of(new AuthPrincipal(userId.longValue(), claims.getSubject(), role));
        } catch (Exception e) {
            return Optional.empty();
        }
    }

    public boolean isValid(String token) {
        return authenticate(token).isPresent();
    }
}
