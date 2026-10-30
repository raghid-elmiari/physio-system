package com.physio.assistant.repository;

import com.physio.assistant.entity.SessionReport;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

public interface SessionReportRepository extends JpaRepository<SessionReport, Long> {
    Optional<SessionReport> findBySessionId(Long sessionId);
    List<SessionReport> findBySessionIdIn(Collection<Long> sessionIds);
}
