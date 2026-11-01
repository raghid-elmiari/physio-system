package com.physio.assistant.repository;

import com.physio.assistant.entity.VideoReviewHistory;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;

public interface VideoReviewHistoryRepository extends JpaRepository<VideoReviewHistory, Long> {
    List<VideoReviewHistory> findBySubmissionIdOrderByCreatedAtAscIdAsc(Long submissionId);
    List<VideoReviewHistory> findBySubmissionIdInOrderByCreatedAtDescIdDesc(Collection<Long> submissionIds);
}
