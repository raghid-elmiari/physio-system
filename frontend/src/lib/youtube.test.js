import { describe, expect, it } from "vitest";
import { embedUrl, extractYouTubeId, thumbnailUrl } from "./youtube";

describe("extractYouTubeId", () => {
  it("accepts the supported link formats", () => {
    expect(extractYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=4")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://youtu.be/dQw4w9WgXcQ?si=x")).toBe("dQw4w9WgXcQ");
    expect(extractYouTubeId("https://www.youtube.com/shorts/abc-DEF_123")).toBe("abc-DEF_123");
    expect(extractYouTubeId("youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("rejects other hosts, HTML and malformed IDs", () => {
    expect(extractYouTubeId("https://vimeo.com/1234")).toBeNull();
    expect(extractYouTubeId("https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeId('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ">')).toBeNull();
    expect(extractYouTubeId("javascript:alert(1)")).toBeNull();
    expect(extractYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(extractYouTubeId("https://user:pw@youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(extractYouTubeId(null)).toBeNull();
  });

  it("builds embeds only from valid IDs", () => {
    expect(embedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
    expect(embedUrl('x"><script>')).toBeNull();
    expect(thumbnailUrl("../../etc")).toBeNull();
  });
});
