package com.physio.assistant.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.LocalDateTime;
import java.util.List;

public class VideoDtos {

    public record VideoSubmissionRequest(
            @NotBlank(message = "Paste a YouTube link") @Size(max = 500) String url,
            Long exerciseId,
            @Size(max = 1000) String description,
            @Size(max = 1000) String reason
    ) {}

    public record ApproveVideoRequest(
            @Size(max = 1000) String feedback,
            /** Link the approved video to this library exercise (defaults to the patient's choice). */
            Long exerciseId,
            /** Also list it in the exercise library for other patients' therapists. */
            Boolean addToLibrary,
            /** Patient-specific instructions shown with the resource. */
            @Size(max = 1000) String instructions
    ) {}

    public record ReasonRequest(@NotBlank(message = "A reason is required") @Size(max = 1000) String reason) {}

    public record LibraryVideoRequest(
            @NotBlank(message = "Paste a YouTube link") @Size(max = 500) String url,
            Long exerciseId
    ) {}

    public record LinkVideoRequest(Long exerciseId) {}

    public record AssignVideoRequest(
            @NotNull(message = "videoId is required") Long videoId,
            @Size(max = 1000) String instructions
    ) {}

    public record VideoResponse(
            Long id, String youtubeVideoId, String url, String embedUrl, String title, String thumbnailUrl,
            String channelName, Long exerciseId, String exerciseName, String origin, boolean inLibrary,
            String addedBy, LocalDateTime createdAt
    ) {}

    public record ResourceResponse(
            Long id, VideoResponse video, String instructions, String assignedBy, LocalDateTime createdAt,
            /** A video approves learning material only; it never authorises performing the exercise. */
            String notice
    ) {}

    public record HistoryItem(
            Long id, Long submissionId, String fromStatus, String toStatus, String actorName, String feedback, LocalDateTime createdAt
    ) {}

    public record SubmissionResponse(
            Long id, Long patientId, String patientName, Long therapistId, String therapistName,
            String youtubeVideoId, String url, String embedUrl, String title, String thumbnailUrl, String channelName,
            Long exerciseId, String exerciseName, String description, String reason, String status,
            String reviewedBy, LocalDateTime reviewedAt, String feedback, Long approvedVideoId,
            LocalDateTime createdAt, LocalDateTime updatedAt, List<HistoryItem> history
    ) {}

    /** Patient: everything they can watch. Library demos are only for exercises in their current program. */
    public record PatientVideoLibrary(List<ResourceResponse> resources, List<VideoResponse> programDemonstrations) {}
}
