package com.physio.assistant.video;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * Looks up a video's public title and channel through YouTube's oEmbed endpoint (no API key).
 * The patient never supplies the title. If YouTube cannot be reached the submission still
 * works, just without a title; if YouTube says the video does not exist or cannot be embedded,
 * the caller rejects it.
 */
@Component
public class YouTubeMetadataClient {

    private static final Logger log = LoggerFactory.getLogger(YouTubeMetadataClient.class);

    public enum Availability { AVAILABLE, NOT_FOUND, NOT_EMBEDDABLE, UNKNOWN }

    public record Metadata(Availability availability, String title, String channelName) {}

    private final boolean enabled;
    private final ObjectMapper objectMapper;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3))
            .followRedirects(HttpClient.Redirect.NORMAL).build();

    public YouTubeMetadataClient(@Value("${app.youtube.metadata-enabled:true}") boolean enabled, ObjectMapper objectMapper) {
        this.enabled = enabled;
        this.objectMapper = objectMapper;
    }

    public Metadata fetch(String videoId) {
        if (!enabled || !YouTubeUrls.isValidId(videoId)) return new Metadata(Availability.UNKNOWN, null, null);
        String url = "https://www.youtube.com/oembed?format=json&url="
                + URLEncoder.encode(YouTubeUrls.canonicalUrl(videoId), StandardCharsets.UTF_8);
        try {
            HttpResponse<String> res = http.send(HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(4)).GET().build(),
                    HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() == 404 || res.statusCode() == 400) return new Metadata(Availability.NOT_FOUND, null, null);
            if (res.statusCode() == 401 || res.statusCode() == 403) return new Metadata(Availability.NOT_EMBEDDABLE, null, null);
            if (res.statusCode() != 200) return new Metadata(Availability.UNKNOWN, null, null);
            JsonNode body = objectMapper.readTree(res.body());
            return new Metadata(Availability.AVAILABLE, clean(body.path("title").asText(null), 300),
                    clean(body.path("author_name").asText(null), 200));
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new Metadata(Availability.UNKNOWN, null, null);
        } catch (Exception e) {
            log.info("YouTube metadata lookup failed for {}: {}", videoId, e.toString());
            return new Metadata(Availability.UNKNOWN, null, null);
        }
    }

    /** Plain text only: control characters removed, length capped. Rendering escapes it again. */
    private static String clean(String value, int max) {
        if (value == null) return null;
        String v = value.replaceAll("\\p{Cntrl}", " ").trim();
        if (v.isEmpty()) return null;
        return v.length() > max ? v.substring(0, max) : v;
    }
}
