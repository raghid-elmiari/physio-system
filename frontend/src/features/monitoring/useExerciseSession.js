import { useCallback, useEffect, useRef, useState } from "react";
import { isNetworkError } from "../../api/client";
import { sessionsApi } from "../../api/services";
import { createEvaluatorFor, getAnalyzer } from "../../core/exercises/registry";
import { FeedbackController } from "../../core/feedback/FeedbackController";
import { SessionRecorder, toLocalIso } from "../../core/session/SessionRecorder";
import { VoiceCoach } from "../../core/voice/VoiceCoach";
import { demoKeyframes } from "../../core/testing/demoScript";
import { CameraError, openCamera, openVideoFile } from "../../platform/camera/webCamera";
import { getPoseLandmarker } from "../../platform/pose/webPoseLandmarker";
import { createSpeechEngine } from "../../platform/speech";
import { offlineQueue } from "../../platform/sync";
import { loadVoiceSettings, saveVoiceSettings } from "./voiceSettings";
import { MonitoringPipeline } from "./MonitoringPipeline";

const speechEngine = createSpeechEngine();

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Orchestrates one monitored exercise session in the browser: camera/model setup, the
 * real-time pipeline, voice settings and saving the result (online, or queued offline).
 *
 * status: idle | preparing | ready | running | paused | saving | finished | error
 */
export function useExerciseSession({ exercise, assignment, targetReps }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const pipelineRef = useRef(null);
  const sourceRef = useRef(null);
  const partsRef = useRef(null);
  const serverSessionRef = useRef(null);
  const clientIdRef = useRef(null);

  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [perf, setPerf] = useState(null);
  const [captions, setCaptions] = useState([]);
  const [voice, setVoice] = useState(loadVoiceSettings);
  const [voiceStats, setVoiceStats] = useState(null);
  const [inputMode, setInputMode] = useState("camera"); // camera | file | simulation
  const [sessionInfo, setSessionInfo] = useState({ online: null, sessionId: null });
  const [result, setResult] = useState(null);
  const [modelInfo, setModelInfo] = useState(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [simulationFinished, setSimulationFinished] = useState(false);

  const analyzer = getAnalyzer(exercise?.analyzerKey);
  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Session clock (excludes paused time; the recorder owns the actual measurement).
  useEffect(() => {
    if (status !== "running") return undefined;
    const timer = setInterval(() => setElapsedSeconds(partsRef.current?.recorder.durationSeconds ?? 0), 500);
    return () => clearInterval(timer);
  }, [status]);

  const teardown = useCallback(() => {
    pipelineRef.current?.stop();
    pipelineRef.current = null;
    sourceRef.current?.stop();
    sourceRef.current = null;
    partsRef.current?.coach.cancelAll();
  }, []);

  useEffect(() => teardown, [teardown]);

  // Abort the server-side session if the page is closed mid-way (best effort).
  useEffect(() => {
    const onHide = () => {
      const id = serverSessionRef.current?.id;
      if (id && ["running", "paused"].includes(statusRef.current)) {
        sessionsApi.abort(id, partsRef.current?.recorder.repCount ?? 0).catch(() => {});
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  const updateVoice = useCallback((patch) => {
    setVoice((v) => {
      const next = { ...v, ...patch };
      saveVoiceSettings(next);
      partsRef.current?.coach.updateSettings(next);
      return next;
    });
  }, []);

  /** Opens the input source and loads the model. Must be called from a user gesture (permissions, audio). */
  const prepare = useCallback(
    async ({ mode = "camera", file = null } = {}) => {
      if (!analyzer) return;
      setError(null);
      setStatus("preparing");
      setInputMode(mode);
      teardown();
      speechEngine.unlock();
      try {
        let landmarker = null;
        if (mode !== "simulation") {
          landmarker = await getPoseLandmarker();
          setModelInfo({ variant: landmarker.variant, delegate: landmarker.delegate, modelSource: landmarker.modelSource, wasmSource: landmarker.wasmSource });
          const video = videoRef.current;
          sourceRef.current = mode === "file" ? await openVideoFile(video, file) : await openCamera(video, { facingMode: "user" });
          sourceRef.current.onEnded(() => {
            if (mode === "camera") setError("The camera stopped. Reconnect it and press Start again.");
          });
        } else {
          setModelInfo({ variant: "simulation", delegate: "none" });
          const c = canvasRef.current;
          c.width = 640;
          c.height = 480;
        }

        const evaluator = createEvaluatorFor(exercise.analyzerKey, exercise.analysisConfig, { targetReps });
        const feedback = new FeedbackController({}, { prompts: analyzer.VOICE_PROMPTS, refinedMessages: analyzer.REFINED_MESSAGES });
        const coach = new VoiceCoach(speechEngine, voice, {
          onCaption: (u) => setCaptions((list) => [{ id: u.id, text: u.text, kind: u.kind, at: Date.now() }, ...list].slice(0, 6)),
        });
        const recorder = new SessionRecorder({ errorCatalog: analyzer.ERROR_CATALOG });
        partsRef.current = { evaluator, feedback, coach, recorder, landmarker };
        pipelineRef.current = new MonitoringPipeline({
          video: mode === "simulation" ? null : videoRef.current,
          canvas: canvasRef.current,
          landmarker,
          evaluator,
          feedback,
          coach,
          recorder,
          simulation: mode === "simulation" ? demoKeyframes() : null,
          onUpdate: (u) => {
            if (u.error) {
              console.error("Frame processing error", u.error);
              return;
            }
            setEvaluation(u.evaluation);
            setPerf(u.perf);
            if (u.simulationFinished) setSimulationFinished(true);
          },
        });
        setStatus("ready");
      } catch (err) {
        teardown();
        setStatus("error");
        if (err instanceof CameraError) setError(err.message);
        else setError(`Could not start pose detection: ${err?.message || err}. Check your connection for the first model download, or try another browser.`);
      }
    },
    [analyzer, exercise, targetReps, teardown, voice]
  );

  const start = useCallback(async () => {
    const parts = partsRef.current;
    if (!parts || !pipelineRef.current) return;
    speechEngine.unlock();
    clientIdRef.current = uuid();
    parts.recorder.start();
    parts.coach.sayAll(parts.feedback.start(performance.now()));
    pipelineRef.current.start();
    setStatus("running");
    // Register the session with the backend; monitoring continues even if this fails.
    try {
      const s = await sessionsApi.start({
        exerciseId: exercise.id,
        assignmentId: assignment?.id ?? null,
        roundsRequested: targetReps,
        clientSessionId: clientIdRef.current,
      });
      serverSessionRef.current = s;
      setSessionInfo({ online: true, sessionId: s.id });
    } catch (err) {
      serverSessionRef.current = null;
      setSessionInfo({ online: false, sessionId: null, reason: isNetworkError(err) ? "offline" : "error" });
    }
  }, [exercise, assignment, targetReps]);

  const pause = useCallback(() => {
    pipelineRef.current?.pause();
    partsRef.current?.recorder.pause();
    partsRef.current?.coach.cancelAll();
    setStatus("paused");
  }, []);

  const resume = useCallback(() => {
    pipelineRef.current?.resume();
    partsRef.current?.recorder.resume();
    setStatus("running");
  }, []);

  /** Stops monitoring and saves the summary; queues it locally when the backend is unreachable. */
  const finish = useCallback(async () => {
    const parts = partsRef.current;
    if (!parts) return;
    pipelineRef.current?.stop();
    parts.recorder.pause();
    setStatus("saving");
    sourceRef.current?.stop();
    sourceRef.current = null;

    // Optional diagnostics must never prevent the session itself from being saved.
    let extra = { inputMode };
    try {
      const stats = parts.coach.stats();
      setVoiceStats(stats);
      extra = {
        ...parts.evaluator.summaryMetrics(),
        inputMode,
        poseModel: parts.landmarker?.variant ?? "simulation",
        poseDelegate: parts.landmarker?.delegate ?? "none",
        voiceEnabled: voice.enabled,
        voiceLatencyMsMean: stats.latencyMs.mean,
        voiceLatencyMsP95: stats.latencyMs.p95,
        voiceEngineLatencyMsMean: stats.engineLatencyMs.mean,
        voiceUtterances: stats.spoken,
      };
    } catch (err) {
      console.error("Could not collect session diagnostics", err);
    }
    const summary = parts.recorder.summary(extra);
    const syncBody = {
      clientSessionId: clientIdRef.current,
      exerciseId: exercise.id,
      assignmentId: assignment?.id ?? null,
      roundsRequested: targetReps,
      startedAt: toLocalIso(parts.recorder.startedAtWall),
      endedAt: toLocalIso(new Date()),
      summary,
    };

    const server = serverSessionRef.current;
    try {
      const report = server ? await sessionsApi.complete(server.id, summary) : await sessionsApi.sync(syncBody);
      setResult({ saved: "server", report, summary });
    } catch (err) {
      if (!err?.response || err.response.status >= 500 || isNetworkError(err)) {
        // /sessions/sync is idempotent on clientSessionId and also finalises a session that was started online.
        offlineQueue.enqueue(syncBody);
        setResult({ saved: "queued", summary });
      } else {
        setResult({ saved: "failed", summary, message: err?.response?.data?.message || "The server rejected the session." });
      }
    } finally {
      serverSessionRef.current = null;
      setStatus("finished");
    }
  }, [exercise, assignment, targetReps, inputMode, voice.enabled]);

  const cancel = useCallback(async () => {
    const server = serverSessionRef.current;
    const reps = partsRef.current?.recorder.repCount ?? 0;
    teardown();
    serverSessionRef.current = null;
    setStatus("idle");
    setEvaluation(null);
    if (server) await sessionsApi.abort(server.id, reps).catch(() => {});
  }, [teardown]);

  return {
    videoRef,
    canvasRef,
    analyzer,
    status,
    error,
    evaluation,
    perf,
    captions,
    voice,
    updateVoice,
    voiceStats,
    voiceSupported: speechEngine.isAvailable(),
    listVoices: speechEngine.listVoices,
    inputMode,
    sessionInfo,
    result,
    modelInfo,
    elapsedSeconds,
    prepare,
    start,
    pause,
    resume,
    finish,
    cancel,
    simulationFinished,
  };
}
