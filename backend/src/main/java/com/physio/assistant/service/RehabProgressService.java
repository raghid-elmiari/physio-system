package com.physio.assistant.service;

import com.physio.assistant.dto.ClinicalDtos.*;
import com.physio.assistant.entity.*;
import com.physio.assistant.repository.ExerciseAssignmentRepository;
import com.physio.assistant.repository.ExerciseParameterRepository;
import com.physio.assistant.repository.ExercisePerformanceRepository;
import com.physio.assistant.security.AuthPrincipal;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Compares, per prescription and parameter: the approved baseline, the therapist's target, the
 * latest performance and the history in a period.
 *
 * These are arithmetic comparisons of recorded values, not clinical judgements: progress
 * percentages are only given when they are mathematically meaningful (a non-zero baseline, a
 * target different from it, and at least one recorded value), and every value carries its source.
 */
@Service
public class RehabProgressService {

    public static final String DISCLAIMER = "System-calculated comparison of recorded values. It is not a diagnosis "
            + "or a statement of recovery; computer-vision values are automated and not clinically validated.";

    private final ExerciseAssignmentRepository assignmentRepository;
    private final ExerciseParameterRepository parameterRepository;
    private final ExercisePerformanceRepository performanceRepository;
    private final AssessmentService assessmentService;
    private final PatientAccessPolicy accessPolicy;

    public RehabProgressService(ExerciseAssignmentRepository assignmentRepository, ExerciseParameterRepository parameterRepository,
                                ExercisePerformanceRepository performanceRepository, AssessmentService assessmentService,
                                PatientAccessPolicy accessPolicy) {
        this.assignmentRepository = assignmentRepository;
        this.parameterRepository = parameterRepository;
        this.performanceRepository = performanceRepository;
        this.assessmentService = assessmentService;
        this.accessPolicy = accessPolicy;
    }

    @Transactional(readOnly = true)
    public RehabProgressResponse forStaff(AuthPrincipal staff, Long patientId, LocalDate from, LocalDate to) {
        return compute(accessPolicy.requireAccessiblePatient(staff, patientId), from, to);
    }

    @Transactional(readOnly = true)
    public RehabProgressResponse compute(User patient, LocalDate from, LocalDate to) {
        if (to.isBefore(from)) throw com.physio.assistant.exception.ApiException.badRequest("'to' cannot be before 'from'");
        LocalDateTime start = from.atStartOfDay();
        LocalDateTime end = to.plusDays(1).atStartOfDay();
        Set<String> sources = new TreeSet<>();

        // Baseline values per parameter (therapist corrections win over the superseded originals).
        Optional<PatientAssessment> baseline = assessmentService.baseline(patient.getId());
        Map<Long, Measurement> baselineValues = new HashMap<>();
        baseline.ifPresent(b -> b.getItems().forEach(item -> item.getMeasurements().stream()
                .filter(m -> !m.isSuperseded())
                .forEach(m -> {
                    baselineValues.put(m.getParameter().getId(), m);
                    sources.add(m.getSource().name());
                })));

        List<ExerciseAssignment> all = assignmentRepository.findByPatientIdOrderByCreatedAtDesc(patient.getId());
        List<ExerciseAssignment> current = all.stream().filter(a -> a.getStatus() != ExerciseAssignment.Status.REPLACED).toList();
        List<Long> allIds = all.stream().map(ExerciseAssignment::getId).toList();
        Map<Long, List<ExercisePerformance>> perfByAssignment = allIds.isEmpty() ? Map.of()
                : performanceRepository.findByAssignmentIdInOrderByPerformedAtAsc(allIds).stream()
                    .collect(Collectors.groupingBy(p -> p.getAssignment().getId()));

        List<PrescriptionProgress> rows = new ArrayList<>();
        List<String> attentionExercises = new ArrayList<>();
        int tracked = 0, reached = 0;
        List<Double> pcts = new ArrayList<>();

        for (ExerciseAssignment a : current) {
            // Performance of earlier versions of this prescription counts as its history.
            List<ExercisePerformance> perfs = new ArrayList<>();
            for (ExerciseAssignment v = a; v != null; v = v.getPreviousAssignment()) {
                perfs.addAll(perfByAssignment.getOrDefault(v.getId(), List.of()));
            }
            perfs.sort(Comparator.comparing(ExercisePerformance::getPerformedAt));
            List<ExercisePerformance> upToEnd = perfs.stream().filter(p -> p.getPerformedAt().isBefore(end)).toList();
            List<ExercisePerformance> inPeriod = upToEnd.stream().filter(p -> !p.getPerformedAt().isBefore(start)).toList();
            inPeriod.forEach(p -> sources.add(p.getSource().name()));
            if (inPeriod.isEmpty() && a.getStatus() != ExerciseAssignment.Status.ACTIVE
                    && a.getStatus() != ExerciseAssignment.Status.PAUSED && a.getStatus() != ExerciseAssignment.Status.APPROVED
                    && a.getStatus() != ExerciseAssignment.Status.PENDING_APPROVAL
                    && (a.getUpdatedAt() == null || a.getUpdatedAt().isBefore(start))) {
                continue; // ended before the period and nothing to show
            }

            Map<Long, PrescriptionTarget> targets = a.getTargets().stream()
                    .collect(Collectors.toMap(t -> t.getParameter().getId(), t -> t, (x, y) -> x, LinkedHashMap::new));
            List<ExerciseParameter> params = new ArrayList<>(targets.values().stream().map(PrescriptionTarget::getParameter).toList());
            for (ExerciseParameter p : parameterRepository.findByExerciseIdOrderBySortOrderAscIdAsc(a.getExercise().getId())) {
                boolean hasData = baselineValues.containsKey(p.getId())
                        || upToEnd.stream().anyMatch(e -> e.getMeasurements().stream().anyMatch(m -> m.getParameter().getId().equals(p.getId())));
                if (!targets.containsKey(p.getId()) && hasData) params.add(p);
            }

            List<ParameterProgress> paramRows = new ArrayList<>();
            List<String> attention = new ArrayList<>();
            for (ExerciseParameter p : params) {
                ParameterProgress row = parameterRow(p, baselineValues.get(p.getId()), baseline.map(PatientAssessment::getId).orElse(null),
                        targets.get(p.getId()), upToEnd, inPeriod);
                paramRows.add(row);
                if (row.targetComparable() != null) {
                    tracked++;
                    if (row.targetReached()) reached++;
                }
                if (row.progressPct() != null) pcts.add(row.progressPct());
                if (row.baseline() != null && row.latestComparable() != null) {
                    double base = comparable(row.baseline());
                    boolean worse = p.isHigherIsBetter() ? row.latestComparable() < base : row.latestComparable() > base;
                    if (worse) attention.add(p.getLabel() + " is below the baseline");
                }
            }

            Integer latestPain = upToEnd.stream().filter(e -> e.getPainLevel() != null).reduce((x, y) -> y)
                    .map(ExercisePerformance::getPainLevel).orElse(null);
            Double avgPain = inPeriod.stream().filter(e -> e.getPainLevel() != null).mapToInt(ExercisePerformance::getPainLevel)
                    .average().stream().boxed().findFirst().map(RehabProgressService::round1).orElse(null);
            Integer expected = expectedEntries(a, from, to);
            Double completion = expected == null || expected == 0 ? null
                    : round1(Math.min(100.0, 100.0 * inPeriod.size() / expected));

            if (latestPain != null && latestPain >= PerformanceService.HIGH_PAIN) attention.add("High pain reported (" + latestPain + "/10)");
            if (inPeriod.stream().anyMatch(ExercisePerformance::isFlagged)) attention.add("Flagged entries in this period");
            if (a.getStatus() == ExerciseAssignment.Status.ACTIVE && !to.isBefore(LocalDate.now())
                    && upToEnd.stream().noneMatch(e -> e.getPerformedAt().isAfter(LocalDateTime.now().minusDays(7)))) {
                attention.add("No activity in the last 7 days");
            }
            if (completion != null && completion < 50) attention.add("Under half of the expected sessions were done");
            if (!attention.isEmpty()) attentionExercises.add(a.getExercise().getName());

            rows.add(new PrescriptionProgress(a.getId(), a.getExercise().getId(), a.getExercise().getName(), a.getStatus().name(),
                    a.getStartDate(), a.getEndDate(), a.getSessionsPerWeek(), inPeriod.size(), expected, completion,
                    latestPain, avgPain, paramRows, attention));
        }

        Double avg = pcts.isEmpty() ? null : round1(pcts.stream().mapToDouble(Double::doubleValue).average().orElse(0));
        return new RehabProgressResponse(patient.getId(), patient.getFullName(), from, to,
                baseline.map(PatientAssessment::getId).orElse(null), baseline.map(PatientAssessment::getApprovedAt).orElse(null),
                rows, tracked, reached, avg, attentionExercises, List.copyOf(sources), DISCLAIMER);
    }

    private ParameterProgress parameterRow(ExerciseParameter p, Measurement base, Long baselineAssessmentId, PrescriptionTarget target,
                                           List<ExercisePerformance> upToEnd, List<ExercisePerformance> inPeriod) {
        ValuePoint baselinePoint = base == null ? null
                : new ValuePoint(base.getMeasuredAt(), base.getValue(), base.getValueMin(), base.getValueMax(), base.getSource().name(), base.isFlagged());
        Measurement latest = null;
        for (ExercisePerformance e : upToEnd) {
            for (Measurement m : e.getMeasurements()) if (m.getParameter().getId().equals(p.getId())) latest = m;
        }
        List<ValuePoint> history = new ArrayList<>();
        for (ExercisePerformance e : inPeriod) {
            for (Measurement m : e.getMeasurements()) {
                if (m.getParameter().getId().equals(p.getId())) {
                    history.add(new ValuePoint(e.getPerformedAt(), m.getValue(), m.getValueMin(), m.getValueMax(), m.getSource().name(), m.isFlagged()));
                }
            }
        }
        Double baseC = base == null ? null : base.comparableValue();
        Double targetC = target == null ? null : target.comparableValue();
        Double latestC = latest == null ? null : latest.comparableValue();

        Double remaining = null;
        boolean targetReached = false;
        Double reference = latestC != null ? latestC : baseC;
        if (targetC != null && reference != null) {
            double gap = p.isHigherIsBetter() ? targetC - reference : reference - targetC;
            targetReached = latestC != null && gap <= 0;
            remaining = round1(Math.max(0, gap));
        }

        Double pct = null;
        String note;
        if (targetC == null) note = "No target set";
        else if (baseC == null) note = "No approved baseline for this measurement";
        else if (baseC == 0) note = "Baseline is zero, so a percentage would be misleading";
        else if (Double.compare(targetC, baseC) == 0) note = "Target equals the baseline";
        else if (latestC == null) note = "No performance recorded yet";
        else {
            pct = round1(100.0 * (latestC - baseC) / (targetC - baseC));
            note = null;
        }
        return new ParameterProgress(p.getId(), p.getCode(), target != null ? target.getLabel() : p.getLabel(),
                target != null ? target.getUnit() : p.getUnit(), p.getMeasurementType().name(), p.isRangeMeasurement(), p.isHigherIsBetter(),
                baselinePoint, base == null ? null : baselineAssessmentId,
                target == null ? null : target.getTargetValue(), target == null ? null : target.getTargetMin(),
                target == null ? null : target.getTargetMax(), targetC,
                latest == null ? null : new ValuePoint(latest.getMeasuredAt(), latest.getValue(), latest.getValueMin(), latest.getValueMax(),
                        latest.getSource().name(), latest.isFlagged()),
                latestC, remaining, pct, note, targetReached, history);
    }

    /** sessionsPerWeek × days the prescription was in force within the period (from approval), or null when no frequency is set. */
    private static Integer expectedEntries(ExerciseAssignment a, LocalDate from, LocalDate to) {
        if (a.getSessionsPerWeek() == null || a.getApprovedAt() == null) return null;
        LocalDate first = max(from, max(a.getStartDate(), a.getApprovedAt().toLocalDate()));
        LocalDate last = min(to, min(a.getEndDate(), LocalDate.now()));
        if (a.getStatus() == ExerciseAssignment.Status.COMPLETED || a.getStatus() == ExerciseAssignment.Status.DISCONTINUED
                || a.getStatus() == ExerciseAssignment.Status.PAUSED) {
            if (a.getUpdatedAt() != null) last = min(last, a.getUpdatedAt().toLocalDate());
        }
        if (last.isBefore(first)) return 0;
        long days = ChronoUnit.DAYS.between(first, last) + 1;
        return (int) Math.round(a.getSessionsPerWeek() * days / 7.0);
    }

    private static double comparable(ValuePoint v) {
        if (v.value() != null) return v.value();
        if (v.valueMin() != null && v.valueMax() != null) return v.valueMax() - v.valueMin();
        return v.valueMax() == null ? 0 : v.valueMax();
    }

    private static LocalDate max(LocalDate a, LocalDate b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.isAfter(b) ? a : b;
    }

    private static LocalDate min(LocalDate a, LocalDate b) {
        if (a == null) return b;
        if (b == null) return a;
        return a.isBefore(b) ? a : b;
    }

    private static double round1(double v) {
        return Math.round(v * 10) / 10.0;
    }
}
