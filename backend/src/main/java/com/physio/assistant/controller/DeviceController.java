package com.physio.assistant.controller;

import com.physio.assistant.dto.DeviceDtos.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.service.DeviceService;
import jakarta.validation.Valid;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class DeviceController {

    private final DeviceService deviceService;

    public DeviceController(DeviceService deviceService) {
        this.deviceService = deviceService;
    }

    // Admin-only device registration — restricted via SecurityConfig (/api/admin/** = ROLE_ADMIN).
    @PostMapping("/admin/devices")
    public RegisterDeviceResponse register(@Valid @RequestBody RegisterDeviceRequest request) {
        return deviceService.registerDevice(request);
    }

    // THERAPIST/ADMIN only (SecurityConfig).
    @GetMapping("/devices")
    public List<DeviceStatusResponse> list() {
        return deviceService.listAll();
    }

    // Called by the device itself using its device API key (not a user JWT).
    @PostMapping("/device/heartbeat")
    public void heartbeat(Authentication auth, @Valid @RequestBody HeartbeatRequest request) {
        // A device may only report its own heartbeat.
        if (!request.deviceId().equals(auth.getName())) {
            throw ApiException.forbidden("deviceId does not match the authenticated device");
        }
        deviceService.heartbeat(request.deviceId());
    }
}
