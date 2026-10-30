package com.physio.assistant.service;

import com.physio.assistant.dto.AuthDtos.*;
import com.physio.assistant.entity.RefreshToken;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.RefreshTokenRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.JwtService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;

@Service
public class AuthService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final int refreshTokenDays;
    private final SecureRandom random = new SecureRandom();

    public AuthService(UserRepository userRepository, RefreshTokenRepository refreshTokenRepository,
                       PasswordEncoder passwordEncoder, JwtService jwtService,
                       @Value("${app.jwt.refresh-token-days}") int refreshTokenDays) {
        this.userRepository = userRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTokenDays = refreshTokenDays;
    }

    public static String normalizeEmail(String email) {
        return email == null ? null : email.trim().toLowerCase(Locale.ROOT);
    }

    @Transactional
    public AuthResponse register(RegisterRequest req) {
        String email = normalizeEmail(req.email());
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw ApiException.conflict("An account with this email already exists");
        }
        User user = new User();
        user.setFirstName(req.firstName().trim());
        user.setLastName(req.lastName().trim());
        user.setEmail(email);
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        user.setRole(User.Role.PATIENT); // self-registration is always PATIENT; THERAPIST/ADMIN are provisioned by an admin
        user.setRehabStatus(User.RehabStatus.ASSESSMENT);
        userRepository.save(user);
        return issueTokens(user);
    }

    @Transactional
    public AuthResponse login(LoginRequest req) {
        User user = userRepository.findByEmailIgnoreCase(normalizeEmail(req.email()))
                .orElseThrow(() -> ApiException.unauthorized("Invalid email or password"));
        if (!passwordEncoder.matches(req.password(), user.getPasswordHash())) {
            throw ApiException.unauthorized("Invalid email or password");
        }
        if (user.getStatus() != User.Status.ACTIVE) {
            throw ApiException.forbidden("This account has been disabled");
        }
        return issueTokens(user);
    }

    /** Rotates the refresh token: the presented token is revoked and a new pair is issued. */
    // noRollbackFor: the reuse-detection revocation below must be committed even though we then reject the request.
    @Transactional(noRollbackFor = ApiException.class)
    public AuthResponse refresh(RefreshRequest req) {
        RefreshToken stored = refreshTokenRepository.findByTokenHash(sha256(req.refreshToken()))
                .orElseThrow(() -> ApiException.unauthorized("Invalid refresh token"));
        User user = stored.getUser();
        if (stored.getRevokedAt() != null) {
            // Reuse of an already-rotated token suggests theft: revoke the whole family for this user.
            refreshTokenRepository.revokeAllForUser(user.getId(), LocalDateTime.now());
            throw ApiException.unauthorized("Refresh token has been revoked");
        }
        if (!stored.isUsable()) {
            throw ApiException.unauthorized("Refresh token has expired");
        }
        if (user.getStatus() != User.Status.ACTIVE) {
            throw ApiException.forbidden("This account has been disabled");
        }
        stored.setRevokedAt(LocalDateTime.now());
        return issueTokens(user);
    }

    @Transactional
    public void logout(RefreshRequest req) {
        refreshTokenRepository.findByTokenHash(sha256(req.refreshToken())).ifPresent(t -> {
            if (t.getRevokedAt() == null) t.setRevokedAt(LocalDateTime.now());
        });
    }

    @Transactional
    public void revokeAllSessions(Long userId) {
        refreshTokenRepository.revokeAllForUser(userId, LocalDateTime.now());
    }

    private AuthResponse issueTokens(User user) {
        String token = jwtService.generateAccessToken(user.getId(), user.getEmail(), user.getRole().name());

        byte[] raw = new byte[32];
        random.nextBytes(raw);
        String refreshToken = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        RefreshToken record = new RefreshToken();
        record.setUser(user);
        record.setTokenHash(sha256(refreshToken));
        record.setExpiresAt(LocalDateTime.now().plusDays(refreshTokenDays));
        refreshTokenRepository.save(record);

        return new AuthResponse(token, refreshToken, jwtService.getAccessTokenSeconds(), toSummary(user));
    }

    public static UserSummary toSummary(User user) {
        return new UserSummary(user.getId(), user.getFirstName(), user.getLastName(), user.getEmail(), user.getRole().name());
    }

    static String sha256(String value) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
