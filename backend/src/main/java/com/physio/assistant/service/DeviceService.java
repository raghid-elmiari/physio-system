package com.physio.assistant.service;

import com.physio.assistant.dto.DeviceDtos.*;
import com.physio.assistant.entity.Device;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.DeviceRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;

@Service
public class DeviceService {

    private final DeviceRepository deviceRepository;
    private final PasswordEncoder passwordEncoder;
    private final int offlineTimeoutSeconds;
    private final SecureRandom random = new SecureRandom();

    public DeviceService(
            DeviceRepository deviceRepository,
            PasswordEncoder passwordEncoder,
            @Value("${app.device.offline-timeout-seconds}") int offlineTimeoutSeconds
    ) {
        this.deviceRepository = deviceRepository;
        this.passwordEncoder = passwordEncoder;
        this.offlineTimeoutSeconds = offlineTimeoutSeconds;
    }

    // Admin-only in a real deployment (see SecurityConfig: /api/admin/** requires ROLE_ADMIN).
    @Transactional
    public RegisterDeviceResponse registerDevice(RegisterDeviceRequest req) {
        if (deviceRepository.findByDeviceId(req.deviceId()).isPresent()) {
            throw ApiException.conflict("Device ID already registered: " + req.deviceId());
        }
        byte[] rawKey = new byte[32];
        random.nextBytes(rawKey);
        String apiKey = Base64.getUrlEncoder().withoutPadding().encodeToString(rawKey);

        Device device = new Device();
        device.setDeviceId(req.deviceId());
        device.setDeviceName(req.deviceName());
        device.setApiKeyHash(passwordEncoder.encode(apiKey));
        deviceRepository.save(device);

        // The raw API key is returned exactly once, at registration time, and never again —
        // only its bcrypt hash is stored (Section 15 "Device Authentication": never hardcode
        // or expose credentials after issuance).
        return new RegisterDeviceResponse(device.getDeviceId(), apiKey);
    }

    @Transactional
    public void heartbeat(String deviceId) {
        Device device = deviceRepository.findByDeviceId(deviceId)
                .orElseThrow(() -> ApiException.notFound("Unknown device: " + deviceId));
        device.setLastSeenAt(LocalDateTime.now());
        deviceRepository.save(device);
    }

    public DeviceStatusResponse getStatus(String deviceId) {
        Device device = deviceRepository.findByDeviceId(deviceId)
                .orElseThrow(() -> ApiException.notFound("Unknown device: " + deviceId));
        String status = device.isOnline(offlineTimeoutSeconds) ? "ONLINE" : "OFFLINE";
        return new DeviceStatusResponse(device.getDeviceId(), device.getDeviceName(), status,
                device.getLastSeenAt() == null ? null : device.getLastSeenAt().toString());
    }

    public List<DeviceStatusResponse> listAll() {
        return deviceRepository.findAll().stream()
                .map(d -> new DeviceStatusResponse(d.getDeviceId(), d.getDeviceName(),
                        d.isOnline(offlineTimeoutSeconds) ? "ONLINE" : "OFFLINE",
                        d.getLastSeenAt() == null ? null : d.getLastSeenAt().toString()))
                .toList();
    }

    // Section 17 "Heartbeat": the backend — not the device — is the source of truth for
    // online/offline status, computed from a configurable timeout rather than trusted blindly.
    // This scheduled sweep just logs/exists as the extension point for alerting (Section 24 Alerts);
    // status itself is computed on-demand in getStatus()/listAll() above so it's always fresh.
    @Scheduled(fixedRate = 15000)
    public void offlineSweepPlaceholder() {
        // Intentionally minimal for this MVP: real alerting (writing to the `alerts` table,
        // pushing a WebSocket notification) is a documented extension point, not implemented
        // here, to avoid claiming a notification pipeline that hasn't been built and tested.
    }
}
