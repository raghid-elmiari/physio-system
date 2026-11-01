package com.physio.assistant.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.physio.assistant.entity.AuditLog;
import com.physio.assistant.entity.User;
import com.physio.assistant.repository.AuditLogRepository;
import com.physio.assistant.repository.UserRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

/**
 * Writes the append-only audit trail. Always joins the caller's transaction, so an audit row
 * exists exactly when the change it describes was committed.
 */
@Service
public class AuditService {

    private final AuditLogRepository auditLogRepository;
    private final UserRepository userRepository;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository auditLogRepository, UserRepository userRepository, ObjectMapper objectMapper) {
        this.auditLogRepository = auditLogRepository;
        this.userRepository = userRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * @param actor   who made the change (null for system events)
     * @param patient the patient the change concerns, if any (used for per-patient history)
     * @param details small JSON-serialisable map (before/after values, reasons); may be null
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(AuthPrincipal actor, String action, String entityType, Long entityId,
                       User patient, String summary, Map<String, ?> details) {
        AuditLog log = new AuditLog();
        if (actor != null) {
            log.setActor(userRepository.getReferenceById(actor.userId()));
            log.setActorRole(actor.role());
        }
        log.setAction(action);
        log.setEntityType(entityType);
        log.setEntityId(entityId);
        log.setPatient(patient);
        log.setSummary(summary == null ? null : truncate(summary, 500));
        log.setDetails(toJson(details));
        auditLogRepository.save(log);
    }

    private String toJson(Map<String, ?> details) {
        if (details == null || details.isEmpty()) return null;
        try {
            return objectMapper.writeValueAsString(details);
        } catch (Exception e) {
            return null;
        }
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max - 1) + "…";
    }
}
