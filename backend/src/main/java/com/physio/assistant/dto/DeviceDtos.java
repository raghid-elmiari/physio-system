package com.physio.assistant.dto;

import jakarta.validation.constraints.NotBlank;

public class DeviceDtos {

    public record RegisterDeviceRequest(@NotBlank String deviceId, @NotBlank String deviceName) {}

    public record RegisterDeviceResponse(String deviceId, String apiKey) {}

    public record HeartbeatRequest(@NotBlank String deviceId) {}

    public record DeviceStatusResponse(String deviceId, String deviceName, String status, String lastSeenAt) {}
}
