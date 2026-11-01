package com.physio.assistant;

import com.physio.assistant.video.YouTubeUrls;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class YouTubeUrlsTest {

    @Test
    void acceptsTheSupportedFormats() {
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("https://youtu.be/dQw4w9WgXcQ")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/shorts/abc-DEF_123")).contains("abc-DEF_123");
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("youtube.com/watch?v=dQw4w9WgXcQ")).contains("dQw4w9WgXcQ");
        assertThat(YouTubeUrls.extractVideoId("  https://youtu.be/dQw4w9WgXcQ  ")).contains("dQw4w9WgXcQ");
    }

    @Test
    void rejectsEverythingElse() {
        assertThat(YouTubeUrls.extractVideoId(null)).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://vimeo.com/123456")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://evil.example/?u=https://youtu.be/dQw4w9WgXcQ")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("javascript:alert(1)//youtu.be/dQw4w9WgXcQ")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("ftp://youtu.be/dQw4w9WgXcQ")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("<iframe src=\"https://www.youtube.com/embed/dQw4w9WgXcQ\"></iframe>")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/watch?v=short")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ123")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgX%22Q")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://www.youtube.com/channel/UC123")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://user:pw@youtu.be/dQw4w9WgXcQ")).isEmpty();
        assertThat(YouTubeUrls.extractVideoId("https://youtu.be:8443/dQw4w9WgXcQ")).isEmpty();
    }
}
