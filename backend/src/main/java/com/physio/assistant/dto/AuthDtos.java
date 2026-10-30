package com.physio.assistant.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public class AuthDtos {

    public record RegisterRequest(
            @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 100) String lastName,
            @Email(message = "Enter a valid email address") @NotBlank(message = "Email is required") @Size(max = 255) String email,
            @NotBlank(message = "Password is required")
            @Size(min = 8, max = 72, message = "Password must be 8-72 characters")
            @Pattern(regexp = "^(?=.*[A-Za-z])(?=.*\\d).+$", message = "Password must contain at least one letter and one number")
            String password
    ) {}

    public record LoginRequest(
            @Email(message = "Enter a valid email address") @NotBlank(message = "Email is required") String email,
            @NotBlank(message = "Password is required") String password
    ) {}

    public record RefreshRequest(@NotBlank(message = "refreshToken is required") String refreshToken) {}

    public record AuthResponse(
            String token,
            String refreshToken,
            long expiresInSeconds,
            UserSummary user
    ) {}

    public record UserSummary(Long id, String firstName, String lastName, String email, String role) {}
}
