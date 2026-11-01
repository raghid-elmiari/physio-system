// Client-side mirror of backend YouTubeUrls: used for instant form feedback and to build
// embeds. The backend validates again and is the authority; embeds are only ever built from
// an 11-character ID that matches VIDEO_ID, never from user-supplied URLs or HTML.

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);
const SHORT_HOSTS = new Set(["youtu.be", "www.youtu.be"]);

/** The video ID of a youtube.com/watch?v=, youtu.be/, /shorts/ or /embed/ link, or null. */
export function extractYouTubeId(raw) {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value || value.length > 500 || /[<\s]/.test(value)) return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || (url.port && url.port !== "443" && url.port !== "80")) return null;
  const host = url.hostname.toLowerCase();
  let candidate = null;
  if (SHORT_HOSTS.has(host)) candidate = url.pathname.split("/")[1];
  else if (WATCH_HOSTS.has(host)) {
    if (url.pathname === "/watch" || url.pathname === "/watch/") candidate = url.searchParams.get("v");
    else if (url.pathname.startsWith("/shorts/")) candidate = url.pathname.split("/")[2];
    else if (url.pathname.startsWith("/embed/")) candidate = url.pathname.split("/")[2];
  }
  return candidate && VIDEO_ID.test(candidate) ? candidate : null;
}

/** Privacy-enhanced embed without autoplay, or null for an invalid ID. */
export function embedUrl(videoId) {
  return VIDEO_ID.test(videoId || "") ? `https://www.youtube-nocookie.com/embed/${videoId}?rel=0` : null;
}

export function thumbnailUrl(videoId) {
  return VIDEO_ID.test(videoId || "") ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

export function watchUrl(videoId) {
  return VIDEO_ID.test(videoId || "") ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
