package com.physio.assistant.repository;

import com.physio.assistant.entity.Notification;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface NotificationRepository extends JpaRepository<Notification, Long> {
    List<Notification> findByRecipientIdOrderByCreatedAtDescIdDesc(Long recipientId, Pageable page);
    List<Notification> findByRecipientIdAndReadAtIsNullOrderByCreatedAtDescIdDesc(Long recipientId, Pageable page);
    long countByRecipientIdAndReadAtIsNull(Long recipientId);
    Optional<Notification> findByIdAndRecipientId(Long id, Long recipientId);

    @Modifying
    @Query("update Notification n set n.readAt = :now where n.recipient.id = :recipientId and n.readAt is null")
    int markAllRead(@Param("recipientId") Long recipientId, @Param("now") LocalDateTime now);
}
