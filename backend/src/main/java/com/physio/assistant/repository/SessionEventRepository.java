package com.physio.assistant.repository;

import com.physio.assistant.entity.SessionEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface SessionEventRepository extends JpaRepository<SessionEvent, Long> {
    List<SessionEvent> findBySessionIdOrderBySequenceNoAsc(Long sessionId);
    boolean existsBySessionIdAndEventUid(Long sessionId, String eventUid);
}
