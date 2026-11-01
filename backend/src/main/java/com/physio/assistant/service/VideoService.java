package com.physio.assistant.service;

import com.physio.assistant.dto.VideoDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.exception.ApiException;
import com.physio.assistant.repository.*;
import com.physio.assistant.security.AuthPrincipal;
import com.physio.assistant.video.YouTubeMetadataClient;
import com.physio.assistant.video.YouTubeUrls;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.*;

/**
 * Patient YouTube suggestions, the therapist's review of them, and approved video resources.
 *
 * Two approvals are deliberately independent: approving a video makes it an educational
 * resource; whether the patient may perform the movement is decided only by approving an
 * exercise prescription. Nothing here touches prescriptions.
 */
@Service
public class VideoService {

    public static final String RESOURCE_NOTICE = "Educational resource only. Perform an exercise only when it is in "
            + "your approved program, following your physiotherapist's targets.";

    private final PatientVideoSubmissionRepository submissionRepository;
    private final VideoReviewHistoryRepository historyRepository;
    private final ExerciseVideoRepository videoRepository;
    private final PatientVideoResourceRepository resourceRepository;
    private final ExerciseAssignmentRepository assignmentRepository;
    private final UserRepository userRepository;
    private final ExerciseService exerciseService;
    private final PatientAccessPolicy accessPolicy;
    private final NotificationService notificationService;
    private final AuditService auditService;
    private final YouTubeMetadataClient metadataClient;

    public VideoService(PatientVideoSubmissionRepository submissionRepository, VideoReviewHistoryRepository historyRepository,
                        ExerciseVideoRepository videoRepository, PatientVideoResourceRepository resourceRepository,
                        ExerciseAssignmentRepository assignmentRepository, UserRepository userRepository,
                        ExerciseService exerciseService, PatientAccessPolicy accessPolicy,
                        NotificationService notificationService, AuditService auditService,
                        YouTubeMetadataClient metadataClient) {
        this.submissionRepository = submissionRepository;
        this.historyRepository = historyRepository;
        this.videoRepository = videoRepository;
        this.resourceRepository = resourceRepository;
        this.assignmentRepository = assignmentRepository;
        this.userRepository = userRepository;
        this.exerciseService = exerciseService;
        this.accessPolicy = accessPolicy;
        this.notificationService = notificationService;
        this.auditService = auditService;
        this.metadataClient = metadataClient;
    }

    // ================================================================= patient

    @Transactional
    public SubmissionResponse submit(AuthPrincipal patientPrincipal, VideoSubmissionRequest req) {
        User patient = userRepository.findById(patientPrincipal.userId()).orElseThrow(() -> ApiException.unauthorized("Unknown user"));
        String videoId = requireVideoId(req.url());
        YouTubeMetadataClient.Metadata meta = requireAvailable(videoId);
        boolean duplicate = submissionRepository.findByPatientIdOrderByCreatedAtDesc(patient.getId()).stream()
                .anyMatch(s -> s.getYoutubeVideoId().equals(videoId) && s.getStatus() != PatientVideoSubmission.Status.REJECTED);
        if (duplicate) throw ApiException.conflict("You have already suggested this video");

        PatientVideoSubmission s = new PatientVideoSubmission();
        s.setPatient(patient);
        s.setTherapist(patient.getTherapist());
        s.setExercise(req.exerciseId() == null ? null : exerciseService.require(req.exerciseId()));
        applyVideo(s, req.url(), videoId, meta);
        s.setDescription(blankToNull(req.description()));
        s.setReason(blankToNull(req.reason()));
        s.setStatus(PatientVideoSubmission.Status.PENDING);
        s = submissionRepository.save(s);
        history(s, null, PatientVideoSubmission.Status.PENDING, patient, null);
        auditService.record(patientPrincipal, "VIDEO_SUBMITTED", "VIDEO_SUBMISSION", s.getId(), patient,
                "Suggested YouTube video " + videoId, null);
        notifyTherapist(s, false);
        return toResponse(s, true);
    }

    /** After a revision request the patient may send a different link or more information. */
    @Transactional
    public SubmissionResponse resubmit(AuthPrincipal patientPrincipal, Long submissionId, VideoSubmissionRequest req) {
        PatientVideoSubmission s = requireOwn(patientPrincipal.userId(), submissionId);
        if (s.getStatus() != PatientVideoSubmission.Status.REVISION_REQUESTED) {
            throw ApiException.conflict("Only suggestions your physiotherapist sent back can be changed");
        }
        String videoId = requireVideoId(req.url());
        if (!videoId.equals(s.getYoutubeVideoId())) applyVideo(s, req.url(), videoId, requireAvailable(videoId));
        s.setExercise(req.exerciseId() == null ? null : exerciseService.require(req.exerciseId()));
        s.setDescription(blankToNull(req.description()));
        s.setReason(blankToNull(req.reason()));
        s.setStatus(PatientVideoSubmission.Status.PENDING);
        if (s.getTherapist() == null) s.setTherapist(s.getPatient().getTherapist());
        history(s, PatientVideoSubmission.Status.REVISION_REQUESTED, PatientVideoSubmission.Status.PENDING, s.getPatient(), null);
        auditService.record(patientPrincipal, "VIDEO_RESUBMITTED", "VIDEO_SUBMISSION", s.getId(), s.getPatient(),
                "Resubmitted video suggestion #" + s.getId(), null);
        notifyTherapist(s, true);
        return toResponse(s, true);
    }

    @Transactional(readOnly = true)
    public List<SubmissionResponse> mySubmissions(Long patientId) {
        return submissionRepository.findByPatientIdOrderByCreatedAtDesc(patientId).stream().map(s -> toResponse(s, true)).toList();
    }

    @Transactional(readOnly = true)
    public PatientVideoLibrary myVideos(Long patientId) {
        List<ResourceResponse> resources = resourceRepository.findByPatientIdAndActiveTrueOrderByCreatedAtDesc(patientId).stream()
                .filter(r -> r.getVideo().isActive())
                .map(VideoService::toResponse).toList();
        Set<Long> programExercises = new HashSet<>();
        assignmentRepository.findByPatientIdAndStatusInOrderByCreatedAtDesc(patientId, ExerciseService.PATIENT_PROGRAM_STATUSES)
                .forEach(a -> programExercises.add(a.getExercise().getId()));
        Set<Long> already = new HashSet<>();
        resources.forEach(r -> already.add(r.video().id()));
        List<VideoResponse> demos = programExercises.isEmpty() ? List.of()
                : videoRepository.findByExerciseIdInAndActiveTrueAndInLibraryTrueOrderByCreatedAtDesc(programExercises).stream()
                    .filter(v -> !already.contains(v.getId())).map(VideoService::toResponse).toList();
        return new PatientVideoLibrary(resources, demos);
    }

    // ================================================================= therapist review

    @Transactional(readOnly = true)
    public List<SubmissionResponse> submissionsForStaff(AuthPrincipal staff, String status) {
        List<Long> ids = accessPolicy.caseloadIds(staff);
        if (ids.isEmpty()) return List.of();
        PatientVideoSubmission.Status filter = status == null || status.isBlank() ? null : parseStatus(status);
        return submissionRepository.findByPatientIdInOrderByCreatedAtDesc(ids).stream()
                .filter(s -> filter == null || s.getStatus() == filter)
                .map(s -> toResponse(s, false)).toList();
    }

    @Transactional(readOnly = true)
    public SubmissionResponse submissionForStaff(AuthPrincipal staff, Long id) {
        return toResponse(requireForStaff(staff, id), true);
    }

    @Transactional(readOnly = true)
    public List<HistoryItem> reviewHistory(AuthPrincipal staff) {
        List<Long> ids = accessPolicy.caseloadIds(staff);
        if (ids.isEmpty()) return List.of();
        List<Long> subIds = submissionRepository.findByPatientIdInOrderByCreatedAtDesc(ids).stream().map(PatientVideoSubmission::getId).toList();
        if (subIds.isEmpty()) return List.of();
        return historyRepository.findBySubmissionIdInOrderByCreatedAtDescIdDesc(subIds).stream().limit(200).map(VideoService::toResponse).toList();
    }

    @Transactional
    public SubmissionResponse approve(AuthPrincipal therapist, Long id, ApproveVideoRequest req) {
        PatientVideoSubmission s = requireReviewable(therapist, id);
        User reviewer = userRepository.getReferenceById(therapist.userId());
        Exercise exercise = req != null && req.exerciseId() != null ? exerciseService.require(req.exerciseId()) : s.getExercise();

        ExerciseVideo video = new ExerciseVideo();
        video.setYoutubeVideoId(s.getYoutubeVideoId());
        video.setTitle(s.getTitle());
        video.setThumbnailUrl(YouTubeUrls.thumbnailUrl(s.getYoutubeVideoId()));
        video.setChannelName(s.getChannelName());
        video.setExercise(exercise);
        video.setOrigin(ExerciseVideo.Origin.PATIENT_SUBMISSION);
        video.setInLibrary(req != null && Boolean.TRUE.equals(req.addToLibrary()));
        video.setAddedBy(reviewer);
        video = videoRepository.save(video);

        PatientVideoResource resource = new PatientVideoResource();
        resource.setPatient(s.getPatient());
        resource.setVideo(video);
        resource.setAssignedBy(reviewer);
        resource.setInstructions(req == null ? null : blankToNull(req.instructions()));
        resourceRepository.save(resource);

        return review(therapist, s, PatientVideoSubmission.Status.APPROVED, req == null ? null : req.feedback(), video);
    }

    @Transactional
    public SubmissionResponse reject(AuthPrincipal therapist, Long id, ReasonRequest req) {
        return review(therapist, requireReviewable(therapist, id), PatientVideoSubmission.Status.REJECTED, req.reason(), null);
    }

    @Transactional
    public SubmissionResponse requestRevision(AuthPrincipal therapist, Long id, ReasonRequest req) {
        return review(therapist, requireReviewable(therapist, id), PatientVideoSubmission.Status.REVISION_REQUESTED, req.reason(), null);
    }

    private SubmissionResponse review(AuthPrincipal therapist, PatientVideoSubmission s, PatientVideoSubmission.Status to,
                                      String feedback, ExerciseVideo approvedVideo) {
        User reviewer = userRepository.getReferenceById(therapist.userId());
        PatientVideoSubmission.Status from = s.getStatus();
        s.setStatus(to);
        s.setReviewedBy(reviewer);
        s.setReviewedAt(LocalDateTime.now());
        s.setFeedback(blankToNull(feedback));
        if (approvedVideo != null) s.setApprovedVideo(approvedVideo);
        history(s, from, to, reviewer, s.getFeedback());
        auditService.record(therapist, "VIDEO_" + to.name(), "VIDEO_SUBMISSION", s.getId(), s.getPatient(),
                "Video suggestion #" + s.getId() + ": " + from + " → " + to,
                s.getFeedback() == null ? null : Map.of("feedback", s.getFeedback()));
        String title = s.getTitle() == null ? "your video suggestion" : "\"" + s.getTitle() + "\"";
        switch (to) {
            case APPROVED -> notificationService.notify(s.getPatient(), NotificationService.VIDEO_APPROVED,
                    "Your physiotherapist approved " + title,
                    "It is now in your videos as learning material. " + (s.getFeedback() == null ? "" : s.getFeedback()),
                    "/videos", "VIDEO_SUBMISSION", s.getId());
            case REJECTED -> notificationService.notify(s.getPatient(), NotificationService.VIDEO_REJECTED,
                    "Your physiotherapist declined " + title, s.getFeedback(), "/videos", "VIDEO_SUBMISSION", s.getId());
            case REVISION_REQUESTED -> notificationService.notify(s.getPatient(), NotificationService.VIDEO_REVISION_REQUESTED,
                    "Your physiotherapist asked for changes to " + title, s.getFeedback(), "/videos", "VIDEO_SUBMISSION", s.getId());
            default -> { }
        }
        return toResponse(s, true);
    }

    /** Called when an administrator assigns or changes a patient's therapist. */
    @Transactional
    public void routePendingSubmissions(User patient) {
        for (PatientVideoSubmission s : submissionRepository.findByPatientIdAndStatus(patient.getId(), PatientVideoSubmission.Status.PENDING)) {
            boolean changed = patient.getTherapist() != null
                    && (s.getTherapist() == null || !s.getTherapist().getId().equals(patient.getTherapist().getId()));
            s.setTherapist(patient.getTherapist());
            if (changed) notifyTherapist(s, false);
        }
    }

    // ================================================================= library & resources

    @Transactional(readOnly = true)
    public List<VideoResponse> library(Long exerciseId) {
        List<ExerciseVideo> videos = exerciseId == null ? videoRepository.findByActiveTrueAndInLibraryTrueOrderByCreatedAtDesc()
                : videoRepository.findByExerciseIdAndActiveTrueAndInLibraryTrueOrderByCreatedAtDesc(exerciseId);
        return videos.stream().map(VideoService::toResponse).toList();
    }

    /** A therapist adds a demonstration video straight to the library. */
    @Transactional
    public VideoResponse addToLibrary(AuthPrincipal therapist, LibraryVideoRequest req) {
        String videoId = requireVideoId(req.url());
        YouTubeMetadataClient.Metadata meta = requireAvailable(videoId);
        ExerciseVideo video = new ExerciseVideo();
        video.setYoutubeVideoId(videoId);
        video.setTitle(meta.title());
        video.setChannelName(meta.channelName());
        video.setThumbnailUrl(YouTubeUrls.thumbnailUrl(videoId));
        video.setExercise(req.exerciseId() == null ? null : exerciseService.require(req.exerciseId()));
        video.setOrigin(ExerciseVideo.Origin.THERAPIST);
        video.setInLibrary(true);
        video.setAddedBy(userRepository.getReferenceById(therapist.userId()));
        video = videoRepository.save(video);
        auditService.record(therapist, "LIBRARY_VIDEO_ADDED", "VIDEO", video.getId(), null,
                "Added YouTube video " + videoId + " to the library", null);
        return toResponse(video);
    }

    @Transactional
    public VideoResponse linkToExercise(AuthPrincipal therapist, Long videoId, LinkVideoRequest req) {
        ExerciseVideo video = requireVideo(videoId);
        video.setExercise(req.exerciseId() == null ? null : exerciseService.require(req.exerciseId()));
        auditService.record(therapist, "LIBRARY_VIDEO_LINKED", "VIDEO", video.getId(), null,
                "Linked video " + video.getYoutubeVideoId() + " to " + (video.getExercise() == null ? "no exercise" : video.getExercise().getName()), null);
        return toResponse(video);
    }

    /** Removes a video from the library (kept for history; existing patient resources stop showing it). */
    @Transactional
    public void removeFromLibrary(AuthPrincipal therapist, Long videoId) {
        ExerciseVideo video = requireVideo(videoId);
        video.setInLibrary(false);
        video.setActive(false);
        auditService.record(therapist, "LIBRARY_VIDEO_REMOVED", "VIDEO", video.getId(), null,
                "Removed video " + video.getYoutubeVideoId() + " from the library", null);
    }

    @Transactional(readOnly = true)
    public List<ResourceResponse> patientResources(AuthPrincipal staff, Long patientId) {
        accessPolicy.requireAccessiblePatient(staff, patientId);
        return resourceRepository.findByPatientIdAndActiveTrueOrderByCreatedAtDesc(patientId).stream()
                .map(VideoService::toResponse).toList();
    }

    @Transactional
    public ResourceResponse assignResource(AuthPrincipal therapist, Long patientId, AssignVideoRequest req) {
        User patient = accessPolicy.requireTreatingTherapist(therapist, patientId);
        ExerciseVideo video = requireVideo(req.videoId());
        if (!video.isActive()) throw ApiException.conflict("This video was removed from the library");
        if (resourceRepository.findFirstByPatientIdAndVideoIdAndActiveTrue(patientId, video.getId()).isPresent()) {
            throw ApiException.conflict("The patient already has this video");
        }
        PatientVideoResource r = new PatientVideoResource();
        r.setPatient(patient);
        r.setVideo(video);
        r.setAssignedBy(userRepository.getReferenceById(therapist.userId()));
        r.setInstructions(blankToNull(req.instructions()));
        r = resourceRepository.save(r);
        auditService.record(therapist, "VIDEO_RESOURCE_ASSIGNED", "VIDEO_RESOURCE", r.getId(), patient,
                "Shared video " + video.getYoutubeVideoId() + " with the patient", null);
        return toResponse(r);
    }

    @Transactional
    public void removeResource(AuthPrincipal therapist, Long resourceId) {
        PatientVideoResource r = resourceRepository.findById(resourceId)
                .filter(x -> accessPolicy.canAccess(therapist, x.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Resource not found: " + resourceId));
        accessPolicy.requireTreatingTherapist(therapist, r.getPatient().getId());
        if (!r.isActive()) return;
        r.setActive(false);
        r.setRemovedAt(LocalDateTime.now());
        r.setRemovedBy(userRepository.getReferenceById(therapist.userId()));
        auditService.record(therapist, "VIDEO_RESOURCE_REMOVED", "VIDEO_RESOURCE", r.getId(), r.getPatient(),
                "Removed video " + r.getVideo().getYoutubeVideoId() + " from the patient's resources", null);
    }

    // ================================================================= helpers

    private String requireVideoId(String url) {
        return YouTubeUrls.extractVideoId(url).orElseThrow(() -> ApiException.badRequest(
                "Enter a YouTube link like youtube.com/watch?v=…, youtu.be/… or youtube.com/shorts/…"));
    }

    private YouTubeMetadataClient.Metadata requireAvailable(String videoId) {
        YouTubeMetadataClient.Metadata meta = metadataClient.fetch(videoId);
        if (meta.availability() == YouTubeMetadataClient.Availability.NOT_FOUND) {
            throw ApiException.badRequest("YouTube says this video does not exist");
        }
        if (meta.availability() == YouTubeMetadataClient.Availability.NOT_EMBEDDABLE) {
            throw ApiException.badRequest("This video is private or cannot be played outside YouTube");
        }
        return meta;
    }

    private static void applyVideo(PatientVideoSubmission s, String url, String videoId, YouTubeMetadataClient.Metadata meta) {
        s.setYoutubeVideoId(videoId);
        s.setOriginalUrl(url.trim().length() > 500 ? YouTubeUrls.canonicalUrl(videoId) : url.trim());
        s.setTitle(meta.title());
        s.setChannelName(meta.channelName());
        s.setThumbnailUrl(YouTubeUrls.thumbnailUrl(videoId));
    }

    private void notifyTherapist(PatientVideoSubmission s, boolean resubmitted) {
        String message = String.join("\n", List.of(
                "Video: " + (s.getTitle() == null ? "(title unavailable)" : s.getTitle()),
                "Link: " + YouTubeUrls.canonicalUrl(s.getYoutubeVideoId()),
                "Related exercise: " + (s.getExercise() == null ? "none selected" : s.getExercise().getName()),
                "Description: " + (s.getDescription() == null ? "—" : s.getDescription())));
        notificationService.notify(s.getTherapist(), NotificationService.VIDEO_SUBMITTED,
                s.getPatient().getFullName() + (resubmitted ? " resubmitted a video suggestion" : " suggested a YouTube video"),
                message, "/therapist/videos/" + s.getId(), "VIDEO_SUBMISSION", s.getId());
    }

    private void history(PatientVideoSubmission s, PatientVideoSubmission.Status from, PatientVideoSubmission.Status to,
                         User actor, String feedback) {
        VideoReviewHistory h = new VideoReviewHistory();
        h.setSubmission(s);
        h.setFromStatus(from);
        h.setToStatus(to);
        h.setActor(actor);
        h.setFeedback(feedback);
        historyRepository.save(h);
    }

    private PatientVideoSubmission requireOwn(Long patientId, Long id) {
        return submissionRepository.findById(id).filter(s -> s.getPatient().getId().equals(patientId))
                .orElseThrow(() -> ApiException.notFound("Video suggestion not found: " + id));
    }

    private PatientVideoSubmission requireForStaff(AuthPrincipal staff, Long id) {
        return submissionRepository.findById(id).filter(s -> accessPolicy.canAccess(staff, s.getPatient()))
                .orElseThrow(() -> ApiException.notFound("Video suggestion not found: " + id));
    }

    /** Only the patient's assigned physiotherapist may review, and only a pending suggestion. */
    private PatientVideoSubmission requireReviewable(AuthPrincipal therapist, Long id) {
        PatientVideoSubmission s = requireForStaff(therapist, id);
        accessPolicy.requireTreatingTherapist(therapist, s.getPatient().getId());
        if (s.getStatus() != PatientVideoSubmission.Status.PENDING) {
            throw ApiException.conflict("This suggestion has already been reviewed (" + s.getStatus() + ")");
        }
        return s;
    }

    private ExerciseVideo requireVideo(Long id) {
        return videoRepository.findById(id).orElseThrow(() -> ApiException.notFound("Video not found: " + id));
    }

    private static PatientVideoSubmission.Status parseStatus(String status) {
        try {
            return PatientVideoSubmission.Status.valueOf(status.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("Unknown status: " + status);
        }
    }

    private SubmissionResponse toResponse(PatientVideoSubmission s, boolean withHistory) {
        List<HistoryItem> history = withHistory
                ? historyRepository.findBySubmissionIdOrderByCreatedAtAscIdAsc(s.getId()).stream().map(VideoService::toResponse).toList()
                : List.of();
        return new SubmissionResponse(s.getId(), s.getPatient().getId(), s.getPatient().getFullName(),
                s.getTherapist() == null ? null : s.getTherapist().getId(),
                s.getTherapist() == null ? null : s.getTherapist().getFullName(),
                s.getYoutubeVideoId(), YouTubeUrls.canonicalUrl(s.getYoutubeVideoId()), embedUrl(s.getYoutubeVideoId()),
                s.getTitle(), YouTubeUrls.thumbnailUrl(s.getYoutubeVideoId()), s.getChannelName(),
                s.getExercise() == null ? null : s.getExercise().getId(), s.getExercise() == null ? null : s.getExercise().getName(),
                s.getDescription(), s.getReason(), s.getStatus().name(),
                s.getReviewedBy() == null ? null : s.getReviewedBy().getFullName(), s.getReviewedAt(), s.getFeedback(),
                s.getApprovedVideo() == null ? null : s.getApprovedVideo().getId(), s.getCreatedAt(), s.getUpdatedAt(), history);
    }

    static VideoResponse toResponse(ExerciseVideo v) {
        return new VideoResponse(v.getId(), v.getYoutubeVideoId(), YouTubeUrls.canonicalUrl(v.getYoutubeVideoId()),
                embedUrl(v.getYoutubeVideoId()), v.getTitle(), YouTubeUrls.thumbnailUrl(v.getYoutubeVideoId()), v.getChannelName(),
                v.getExercise() == null ? null : v.getExercise().getId(), v.getExercise() == null ? null : v.getExercise().getName(),
                v.getOrigin().name(), v.isInLibrary(), v.getAddedBy() == null ? null : v.getAddedBy().getFullName(), v.getCreatedAt());
    }

    static ResourceResponse toResponse(PatientVideoResource r) {
        return new ResourceResponse(r.getId(), toResponse(r.getVideo()), r.getInstructions(),
                r.getAssignedBy() == null ? null : r.getAssignedBy().getFullName(), r.getCreatedAt(), RESOURCE_NOTICE);
    }

    static HistoryItem toResponse(VideoReviewHistory h) {
        return new HistoryItem(h.getId(), h.getSubmission().getId(), h.getFromStatus() == null ? null : h.getFromStatus().name(),
                h.getToStatus().name(), h.getActor() == null ? "System" : h.getActor().getFullName(), h.getFeedback(), h.getCreatedAt());
    }

    /** Privacy-enhanced, no autoplay; built from the validated ID only. */
    static String embedUrl(String videoId) {
        return "https://www.youtube-nocookie.com/embed/" + videoId + "?rel=0";
    }

    private static String blankToNull(String v) {
        return v == null || v.isBlank() ? null : v.trim();
    }
}
