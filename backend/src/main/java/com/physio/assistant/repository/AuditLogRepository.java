package com.physio.assistant.repository;

import com.physio.assistant.entity.AuditLog;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface AuditLogRepository extends JpaRepository<AuditLog, Long> {

    @Query("select a from AuditLog a where (:entityType is null or a.entityType = :entityType) "
            + "and (:actorId is null or a.actor.id = :actorId) order by a.createdAt desc, a.id desc")
    Page<AuditLog> search(@Param("entityType") String entityType, @Param("actorId") Long actorId, Pageable page);

    List<AuditLog> findByEntityTypeAndEntityIdOrderByCreatedAtAscIdAsc(String entityType, Long entityId);

    List<AuditLog> findByPatientIdOrderByCreatedAtDescIdDesc(Long patientId, Pageable page);
}
