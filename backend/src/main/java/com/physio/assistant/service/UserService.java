package com.physio.assistant.service;

import com.physio.assistant.dto.UserDtos.*;
import com.physio.assistant.entity.User;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.UserRepository;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final AuthService authService;

    public UserService(UserRepository userRepository, PasswordEncoder passwordEncoder, AuthService authService) {
        this.userRepository = userRepository;
        this.passwordEncoder = passwordEncoder;
        this.authService = authService;
    }

    public User require(Long userId) {
        return userRepository.findById(userId).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
    }

    @Transactional(readOnly = true)
    public ProfileResponse getProfile(Long userId) {
        return toProfile(require(userId));
    }

    @Transactional
    public ProfileResponse updateProfile(Long userId, UpdateProfileRequest req) {
        User user = require(userId);
        user.setFirstName(req.firstName().trim());
        user.setLastName(req.lastName().trim());
        return toProfile(user);
    }

    @Transactional
    public void changePassword(Long userId, ChangePasswordRequest req) {
        User user = require(userId);
        if (!passwordEncoder.matches(req.currentPassword(), user.getPasswordHash())) {
            throw ApiException.badRequest("Current password is incorrect");
        }
        user.setPasswordHash(passwordEncoder.encode(req.newPassword()));
        // Sign out every other device: existing refresh tokens stop working.
        authService.revokeAllSessions(userId);
    }

    private ProfileResponse toProfile(User u) {
        User t = u.getTherapist();
        TherapistSummary therapist = t == null ? null
                : new TherapistSummary(t.getId(), t.getFirstName(), t.getLastName(), t.getEmail());
        return new ProfileResponse(u.getId(), u.getFirstName(), u.getLastName(), u.getEmail(),
                u.getRole().name(), therapist, u.getCreatedAt());
    }
}
