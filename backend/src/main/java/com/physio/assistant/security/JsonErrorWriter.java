package com.physio.assistant.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;
import java.time.Instant;

/** Writes the same error body shape as GlobalExceptionHandler from inside the filter chain. */
public final class JsonErrorWriter {
    private JsonErrorWriter() {}

    public static void write(HttpServletRequest request, HttpServletResponse response, int status,
                             String error, String message) throws IOException {
        response.setStatus(status);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write("{\"timestamp\":\"" + Instant.now() + "\",\"status\":" + status
                + ",\"error\":\"" + error + "\",\"message\":\"" + message.replace("\"", "'")
                + "\",\"path\":\"" + request.getRequestURI().replace("\"", "") + "\"}");
    }
}
