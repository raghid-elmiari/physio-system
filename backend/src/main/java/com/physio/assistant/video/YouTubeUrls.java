package com.physio.assistant.video;

import java.net.URI;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Extracts a YouTube video ID from a pasted link. Only these forms are accepted:
 * youtube.com/watch?v=ID, youtu.be/ID, youtube.com/shorts/ID and youtube.com/embed/ID,
 * over http(s), on YouTube's own hosts. Anything else (other hosts, iframe HTML, javascript:)
 * is rejected. The ID is always exactly 11 characters of [A-Za-z0-9_-].
 */
public final class YouTubeUrls {

    public static final Pattern VIDEO_ID = Pattern.compile("^[A-Za-z0-9_-]{11}$");
    private static final Set<String> WATCH_HOSTS = Set.of("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com");
    private static final Set<String> SHORT_HOSTS = Set.of("youtu.be", "www.youtu.be");

    private YouTubeUrls() {}

    public static Optional<String> extractVideoId(String rawUrl) {
        if (rawUrl == null) return Optional.empty();
        String trimmed = rawUrl.trim();
        if (trimmed.isEmpty() || trimmed.length() > 500 || trimmed.contains("<") || trimmed.contains(" ")) return Optional.empty();
        if (!trimmed.matches("(?i)^https?://.*")) trimmed = "https://" + trimmed;
        URI uri;
        try {
            uri = new URI(trimmed);
        } catch (Exception e) {
            return Optional.empty();
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) return Optional.empty();
        if (uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443 && uri.getPort() != 80)) return Optional.empty();
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getRawPath() == null ? "" : uri.getRawPath();

        String candidate = null;
        if (SHORT_HOSTS.contains(host)) {
            candidate = firstSegment(path);
        } else if (WATCH_HOSTS.contains(host)) {
            if (path.equals("/watch") || path.equals("/watch/")) {
                candidate = queryParam(uri.getRawQuery(), "v");
            } else if (path.startsWith("/shorts/")) {
                candidate = firstSegment(path.substring("/shorts".length()));
            } else if (path.startsWith("/embed/")) {
                candidate = firstSegment(path.substring("/embed".length()));
            }
        }
        return candidate != null && VIDEO_ID.matcher(candidate).matches() ? Optional.of(candidate) : Optional.empty();
    }

    public static boolean isValidId(String id) {
        return id != null && VIDEO_ID.matcher(id).matches();
    }

    public static String canonicalUrl(String videoId) {
        return "https://www.youtube.com/watch?v=" + videoId;
    }

    /** Built from the validated ID only; never a URL supplied by a user or a third party. */
    public static String thumbnailUrl(String videoId) {
        return "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";
    }

    private static String firstSegment(String path) {
        String p = path.startsWith("/") ? path.substring(1) : path;
        int slash = p.indexOf('/');
        return slash >= 0 ? p.substring(0, slash) : p;
    }

    private static String queryParam(String rawQuery, String name) {
        if (rawQuery == null) return null;
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0 && pair.substring(0, eq).equals(name)) return pair.substring(eq + 1);
        }
        return null;
    }
}
