// Browser camera access (getUserMedia). The rest of the pipeline only needs a source that
// can be drawn/fed to the pose model; a native build replaces this module with a native
// camera plugin and keeps the same error codes.

export const CAMERA_ERRORS = Object.freeze({
  INSECURE_CONTEXT: "The camera only works on https:// or http://localhost. Open the app from a secure address.",
  UNSUPPORTED: "This browser does not support camera access.",
  PERMISSION_DENIED: "Camera permission was denied. Allow camera access in your browser or phone settings, then try again.",
  NO_CAMERA: "No camera was found on this device.",
  CAMERA_IN_USE: "The camera is being used by another app. Close it and try again.",
  OVERCONSTRAINED: "The camera does not support the requested settings.",
  UNKNOWN: "The camera could not be started.",
});

export class CameraError extends Error {
  constructor(code, cause) {
    super(CAMERA_ERRORS[code] || CAMERA_ERRORS.UNKNOWN);
    this.code = code;
    this.cause = cause;
  }
}

function classify(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "PERMISSION_DENIED";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "NO_CAMERA";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "CAMERA_IN_USE";
    case "OverconstrainedError":
      return "OVERCONSTRAINED";
    default:
      return "UNKNOWN";
  }
}

/** Current permission state without prompting ("granted" | "denied" | "prompt" | "unknown"). */
export async function cameraPermissionState() {
  try {
    const status = await navigator.permissions?.query({ name: "camera" });
    return status?.state || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Opens the camera and attaches it to a <video> element.
 * @param {HTMLVideoElement} video
 * @param {{facingMode?: "user"|"environment", width?: number, height?: number, frameRate?: number}} opts
 * @returns {Promise<{stop: () => void, settings: MediaTrackSettings, onEnded: (fn: Function) => void}>}
 */
export async function openCamera(video, { facingMode = "user", width = 640, height = 480, frameRate = 30 } = {}) {
  if (typeof window !== "undefined" && window.isSecureContext === false) throw new CameraError("INSECURE_CONTEXT");
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraError("UNSUPPORTED");

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate, max: 60 } },
    });
  } catch (err) {
    const code = classify(err);
    if (code === "OVERCONSTRAINED") {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (err2) {
        throw new CameraError(classify(err2), err2);
      }
    } else {
      throw new CameraError(code, err);
    }
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play().catch(() => {});
  if (video.readyState < 2) {
    await new Promise((resolve) => video.addEventListener("loadeddata", resolve, { once: true }));
  }

  const track = stream.getVideoTracks()[0];
  return {
    settings: track?.getSettings?.() || {},
    onEnded: (fn) => track?.addEventListener("ended", fn),
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}

/**
 * Plays a local video file instead of the camera (testing / demo with recorded footage).
 * Nothing is uploaded: the file is read through an object URL in the browser only.
 */
export async function openVideoFile(video, file, { loop = false } = {}) {
  const url = URL.createObjectURL(file);
  video.srcObject = null;
  video.src = url;
  video.muted = true;
  video.loop = loop;
  video.playsInline = true;
  await new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", resolve, { once: true });
    video.addEventListener("error", () => reject(new CameraError("UNKNOWN")), { once: true });
  });
  await video.play();
  return {
    settings: { width: video.videoWidth, height: video.videoHeight },
    onEnded: (fn) => video.addEventListener("ended", fn),
    stop() {
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    },
  };
}
