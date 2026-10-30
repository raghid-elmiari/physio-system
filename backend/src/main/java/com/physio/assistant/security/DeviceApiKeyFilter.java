package com.physio.assistant.security;

import com.physio.assistant.entity.Device;
import com.physio.assistant.repository.DeviceRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.lang.NonNull;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * Separate auth path for embedded devices (UNO Q agents), distinct from user JWT auth.
 * Applies only to /api/device/** ingestion routes. Section 15 of the spec: "never allow
 * an unknown device to freely submit data" — every request must carry a valid
 * X-Device-Id + X-Api-Key pair that matches a registered, ACTIVE device.
 */
@Component
public class DeviceApiKeyFilter extends OncePerRequestFilter {

    private final DeviceRepository deviceRepository;
    private final PasswordEncoder passwordEncoder;

    public DeviceApiKeyFilter(DeviceRepository deviceRepository, PasswordEncoder passwordEncoder) {
        this.deviceRepository = deviceRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/device/");
    }

    @Override
    protected void doFilterInternal(
            @NonNull HttpServletRequest request,
            @NonNull HttpServletResponse response,
            @NonNull FilterChain filterChain
    ) throws ServletException, IOException {

        String deviceId = request.getHeader("X-Device-Id");
        String apiKey = request.getHeader("X-Api-Key");

        if (deviceId == null || apiKey == null) {
            JsonErrorWriter.write(request, response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized", "Missing device credentials");
            return;
        }

        Optional<Device> deviceOpt = deviceRepository.findByDeviceId(deviceId);
        if (deviceOpt.isEmpty()
                || deviceOpt.get().getStatus() != Device.Status.ACTIVE
                || !passwordEncoder.matches(apiKey, deviceOpt.get().getApiKeyHash())) {
            JsonErrorWriter.write(request, response, HttpServletResponse.SC_UNAUTHORIZED, "Unauthorized", "Invalid or inactive device credentials");
            return;
        }

        var authToken = new UsernamePasswordAuthenticationToken(
                deviceId, null, List.of(new SimpleGrantedAuthority("ROLE_DEVICE")));
        SecurityContextHolder.getContext().setAuthentication(authToken);
        filterChain.doFilter(request, response);
    }
}
