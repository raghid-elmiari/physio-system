// Lays out a stored patient report (ReportDtos.ReportResponse) as a PDF file.
import { PdfDocument } from "../../lib/pdf/PdfDocument";
import { formatCalendarDate, formatDateTime, formatDuration } from "../../lib/format";
import { DIFFICULTY_LABELS, PRESCRIPTION_STATUS_LABELS, SOURCE_LABELS, SOURCE_SHORT, describeDose, formatMeasured, formatMetric, formatPercent, formatValue, metricLabel } from "../../lib/clinicalLabels";

const MUTED = [91, 107, 130];

export function buildPatientReportPdf(report) {
  const m = report.measurements;
  const pdf = new PdfDocument({ footerText: `PhysioCoach · Confidential patient information · ${m.patient.name}` });

  pdf.title(report.title, `Generated ${formatDateTime(report.createdAt)}${report.authorName ? ` by ${report.authorName}` : ""}`);

  pdf.heading("Patient information");
  pdf.keyValues([
    ["Patient", m.patient.name],
    ["Patient ID", `#${m.patient.id}`],
    ["Date of birth", m.patient.dateOfBirth ? formatCalendarDate(m.patient.dateOfBirth) : "Not recorded"],
    ["Condition", m.patient.primaryCondition || "Not recorded"],
    ["Rehabilitation period", `${formatCalendarDate(m.period.from)} – ${formatCalendarDate(m.period.to)} (${m.period.days} days)`],
    ["Report date", formatCalendarDate(report.createdAt?.slice(0, 10))],
  ]);

  pdf.heading("Assigned exercises");
  if (m.prescriptions.length === 0) {
    pdf.paragraph("No exercise prescription was in force during this period.", { color: MUTED });
  } else {
    pdf.table(
      ["Exercise", "Prescription", "Dates", "Difficulty", "Status", "Done / expected"],
      m.prescriptions.map((p) => [
        p.exerciseName + (p.instructions ? `\n"${p.instructions}"` : ""),
        describeDose(p),
        `${p.startDate ? formatCalendarDate(p.startDate) : "—"} – ${p.endDate ? formatCalendarDate(p.endDate) : "open"}`,
        DIFFICULTY_LABELS[p.difficulty] ?? "—",
        PRESCRIPTION_STATUS_LABELS[p.status] ?? p.status,
        p.expectedSessions ? `${p.completedSessions} / ${p.expectedSessions} (${formatPercent(p.completionPct)})` : `${p.completedSessions}`,
      ]),
      [2.2, 2.2, 1.9, 1, 1.3, 1.4]
    );
  }

  if (m.rehabProgress) addRehabProgress(pdf, m.rehabProgress);

  const t = m.totals;
  pdf.heading("Exercise performance (system-generated)");
  pdf.keyValues(
    [
      ["Completed sessions", String(t.completedSessions)],
      ["Interrupted sessions", String(t.interruptedSessions)],
      ["Missed sessions (estimated)", t.expectedSessions ? String(t.missedSessions) : "No weekly target set"],
      ["Repetitions completed", String(t.totalReps)],
      ["Repetitions without a detected error", String(t.correctReps)],
      ["Average accuracy", formatPercent(t.averageAccuracyPct)],
      ["Total exercise time", formatDuration(t.totalDurationSeconds)],
      ["Completion of prescribed sessions", formatPercent(t.completionPct)],
      ["Movement errors detected", String(t.movementErrorsDetected)],
    ],
    { columns: 3 }
  );
  pdf.paragraph(
    "Sets are not tracked by the camera analysis; repetitions are counted per session. Accuracy is the share of counted repetitions performed without a persistent movement error. Measurements come from on-device pose estimation and are not clinical measurements.",
    { size: 8, color: MUTED }
  );

  if (m.exercises.length > 0) {
    pdf.table(
      ["Exercise", "Sessions", "Reps (correct)", "Time", "Avg accuracy", "First / latest accuracy", "Errors"],
      m.exercises.map((e) => [
        e.exerciseName,
        `${e.completedSessions}${e.interruptedSessions ? ` (+${e.interruptedSessions} interrupted)` : ""}`,
        `${e.totalReps} (${e.correctReps})`,
        formatDuration(e.totalDurationSeconds),
        formatPercent(e.averageAccuracyPct),
        e.firstAccuracyPct != null ? `${formatPercent(e.firstAccuracyPct)} / ${formatPercent(e.latestAccuracyPct)}` : "—",
        String(e.movementErrorsDetected),
      ]),
      [2.4, 1.5, 1.3, 1, 1.1, 1.5, 0.8]
    );

    const measured = m.exercises.filter((e) => Object.keys(e.averageMeasurements || {}).length > 0);
    if (measured.length > 0) {
      pdf.paragraph("Joint-angle and tracking measurements (averages)", { bold: true, size: 10 });
      pdf.table(
        ["Exercise", "Measurement", "Average"],
        measured.flatMap((e) => Object.entries(e.averageMeasurements).map(([key, value]) => [e.exerciseName, metricLabel(key), formatMetric(key, value)])),
        [2, 3, 1]
      );
    }

    const withErrors = m.exercises.filter((e) => e.commonErrors.length > 0);
    if (withErrors.length > 0) {
      pdf.paragraph("Detected movement errors", { bold: true, size: 10 });
      pdf.table(
        ["Exercise", "Error", "Times flagged"],
        withErrors.flatMap((e) => e.commonErrors.map((err) => [e.exerciseName, err.message || err.code, String(err.count)])),
        [2, 4, 1]
      );
    }
  }

  pdf.heading("Progress analysis (system-generated)");
  const prev = m.previousPeriod;
  pdf.keyValues(
    [
      ["Previous period", `${formatCalendarDate(prev.from)} – ${formatCalendarDate(prev.to)}`],
      ["Completed sessions (previous / this period)", `${prev.completedSessions} / ${t.completedSessions}`],
      ["Average accuracy (previous / this period)", `${formatPercent(prev.averageAccuracyPct)} / ${formatPercent(t.averageAccuracyPct)}`],
    ],
    { columns: 3 }
  );
  pdf.paragraph("Areas of improvement", { bold: true });
  pdf.bulletList(m.automatedFindings.improvements.length ? m.automatedFindings.improvements : ["No clear improvement trend detected in this period."]);
  pdf.paragraph("Exercises requiring further attention", { bold: true });
  pdf.bulletList(m.automatedFindings.needsAttention.length ? m.automatedFindings.needsAttention : ["No automated flags raised in this period."]);
  pdf.paragraph(m.automatedFindings.disclaimer, { size: 8, color: MUTED });

  pdf.heading("Physiotherapist's assessment");
  const a = report.assessment;
  const sections = [
    ["Observations", a.observations],
    ["Recommendations", a.recommendations],
    ["Exercise modifications", a.exerciseModifications],
    ["Follow-up instructions", a.followUpInstructions],
  ];
  for (const [label, value] of sections) {
    pdf.paragraph(label, { bold: true, spacingAfter: 2 });
    pdf.paragraph(value || "Not provided.", { color: value ? undefined : MUTED, spacingAfter: 8 });
  }

  if (m.sessions.length > 0) {
    pdf.heading("Session log");
    pdf.table(
      ["Date", "Exercise", "Status", "Reps", "Correct", "Accuracy", "Duration", "Errors"],
      m.sessions.map((s) => [
        formatDateTime(s.startedAt),
        s.exerciseName,
        s.status === "COMPLETED" ? "Completed" : s.status === "ABORTED" ? "Interrupted" : "In progress",
        `${s.repsCompleted ?? 0}/${s.repsRequested ?? "—"}`,
        s.correctReps ?? "—",
        formatPercent(s.accuracyPct),
        formatDuration(s.durationSeconds),
        String(s.movementErrorsDetected),
      ]),
      [2, 2.2, 1.2, 0.9, 0.9, 1, 1, 0.8]
    );
  }

  return pdf.toBytes();
}

/** Baseline vs target vs latest; every value carries its source. */
function addRehabProgress(pdf, r) {
  pdf.heading("Baseline, targets and latest performance (system-calculated)");
  pdf.keyValues([
    ["Baseline approved", r.baselineApprovedAt ? formatDateTime(r.baselineApprovedAt) : "No approved baseline"],
    ["Targets reached", `${r.targetsReached} of ${r.targetsTracked}`],
    ["Average progress", r.averageProgressPct != null ? `${r.averageProgressPct}% of the gap closed` : "Not calculable"],
    ["Measurement sources", r.sources.length ? r.sources.map((s) => SOURCE_LABELS[s] ?? s).join(", ") : "None"],
  ], { columns: 2 });
  const rows = [];
  for (const rx of r.prescriptions) {
    for (const p of rx.parameters) {
      rows.push([
        `${rx.exerciseName}\n${p.label}`,
        p.baseline ? `${formatMeasured(p.baseline, p.unit)} (${SOURCE_SHORT[p.baseline.source]})` : "—",
        p.targetComparable != null ? formatMeasured({ value: p.targetValue, valueMin: p.targetMin, valueMax: p.targetMax }, p.unit) : "—",
        p.latest ? `${formatMeasured(p.latest, p.unit)} (${SOURCE_SHORT[p.latest.source]})` : "—",
        p.remaining != null ? formatValue(p.remaining, p.unit) : "—",
        p.progressPct != null ? `${p.progressPct}%` : p.progressNote || "—",
      ]);
    }
  }
  if (rows.length) {
    pdf.table(["Exercise / measurement", "Baseline", "Target", "Latest", "Remaining", "Progress"], rows, [2.6, 1.5, 1.2, 1.5, 1, 1.8]);
  } else {
    pdf.paragraph("No targets or measured values in this period.", { color: MUTED });
  }
  const attention = r.prescriptions.flatMap((rx) => rx.attention.map((a) => `${rx.exerciseName}: ${a}`));
  if (attention.length) {
    pdf.paragraph("Requires attention", { bold: true });
    pdf.bulletList(attention);
  }
  pdf.paragraph(r.disclaimer, { size: 8, color: MUTED });
}

export function downloadPatientReportPdf(report) {
  const bytes = buildPatientReportPdf(report);
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeName = `${report.measurements.patient.name}-${report.periodStart}-to-${report.periodEnd}`.replace(/[^A-Za-z0-9._-]+/g, "-");
  link.href = url;
  link.download = `report-${safeName}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
