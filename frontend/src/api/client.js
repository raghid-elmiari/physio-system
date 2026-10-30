import axios from "axios";
import { config } from "../config";
import { storage } from "../platform/storage";

// Centralized Axios instance: one place attaches the access token, refreshes it when it
// expires, and normalises errors. Pages never deal with tokens directly.
//
// Token storage: the short-lived access token lives only in memory. The refresh token is
// persisted (platform/storage: localStorage on the web, Capacitor Preferences in the app) so
// a reload keeps the user signed in; it is opaque, rotated on every use and revocable
// server-side. Before a production mobile release, move it to secure storage
// (Keychain / Keystore) — only the storage adapter changes.

const REFRESH_KEY = "physio.refreshToken";

const client = axios.create({
  baseURL: config.apiBaseUrl,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

let accessToken = null;
let refreshPromise = null;
const listeners = new Set();

export function onAuthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(event) {
  for (const fn of listeners) fn(event);
}

export function setTokens({ token, refreshToken }) {
  accessToken = token || null;
  if (refreshToken) storage.setItem(REFRESH_KEY, refreshToken);
}

export function clearTokens() {
  accessToken = null;
  storage.removeItem(REFRESH_KEY);
}

export function getRefreshToken() {
  return storage.getItem(REFRESH_KEY);
}

export function hasAccessToken() {
  return !!accessToken;
}

/** Exchanges the stored refresh token for a new token pair. Concurrent callers share one request. */
export function refreshSession() {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return Promise.reject(new Error("No refresh token"));
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${config.apiBaseUrl}/auth/refresh`, { refreshToken }, { timeout: 15000 })
      .then(({ data }) => {
        setTokens(data);
        return data;
      })
      .catch((err) => {
        // Only a definitive rejection signs the user out; a network failure keeps the token.
        if (err.response && [400, 401, 403].includes(err.response.status)) {
          clearTokens();
          emit("signed-out");
        }
        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

client.interceptors.request.use((cfg) => {
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.startsWith("/auth/");
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall && getRefreshToken()) {
      original._retried = true;
      try {
        await refreshSession();
        original.headers.Authorization = `Bearer ${accessToken}`;
        return client(original);
      } catch {
        // fall through to the original 401
      }
    }
    if (error.response?.status === 401 && !isAuthCall) {
      accessToken = null;
      emit("signed-out");
    }
    return Promise.reject(error);
  }
);

/** True when the request never got an HTTP response (offline, server down, CORS, timeout). */
export function isNetworkError(err) {
  return !!err && !err.response && (err.code === "ERR_NETWORK" || err.code === "ECONNABORTED" || err.message === "Network Error" || !!err.request);
}

/** Human-readable message for any API error. */
export function errorMessage(err, fallback = "Something went wrong. Please try again.") {
  if (isNetworkError(err)) return "Cannot reach the server. Check your connection and that the backend is running.";
  const data = err?.response?.data;
  if (data?.message) return data.message;
  if (err?.response?.status === 403) return "You do not have permission to do that.";
  if (err?.response?.status === 404) return "Not found.";
  return fallback;
}

/** Field-level validation errors returned by the backend ({ field: message }). */
export function fieldErrors(err) {
  return err?.response?.data?.fieldErrors || {};
}

export default client;
