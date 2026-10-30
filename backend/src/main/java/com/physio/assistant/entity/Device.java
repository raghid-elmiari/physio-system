package com.physio.assistant.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;
import java.time.LocalDateTime;

@Entity
@Table(name = "devices")
@Getter
@Setter
public class Device {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false, unique = true, length = 64)
    private String deviceId; // e.g. "UNOQ-001"

    @Column(name = "device_name", nullable = false, length = 150)
    private String deviceName;

    @Column(name = "api_key_hash", nullable = false, length = 255)
    private String apiKeyHash;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "owner_user_id")
    private User owner;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status = Status.ACTIVE;

    @Column(name = "last_seen_at")
    private LocalDateTime lastSeenAt;

    @Column(name = "created_at", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
    }

    /** Computed, not persisted: derived from lastSeenAt vs. the configured timeout. */
    @Transient
    public boolean isOnline(int timeoutSeconds) {
        if (lastSeenAt == null) return false;
        return lastSeenAt.isAfter(LocalDateTime.now().minusSeconds(timeoutSeconds));
    }

    public enum Status { ACTIVE, DISABLED }
}
