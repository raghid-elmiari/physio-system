import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearTokens, errorMessage, fieldErrors, getRefreshToken, isNetworkError, onAuthChange, refreshSession, setTokens } from "../api/client";
import { authApi } from "../api/services";

const AuthContext = createContext(null);
const USER_KEY = "physio.user";

function cachedUser() {
  try {
    return JSON.parse(sessionStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

function cacheUser(user) {
  try {
    if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(USER_KEY);
  } catch {
    // storage unavailable: nothing to cache
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // "restoring" until we know whether a stored refresh token still yields a session.
  const [status, setStatus] = useState(getRefreshToken() ? "restoring" : "ready");

  const applyAuth = useCallback((data) => {
    setTokens(data);
    setUser(data.user);
    cacheUser(data.user);
  }, []);

  // Restore the session after a reload using the stored refresh token.
  useEffect(() => {
    if (!getRefreshToken()) return;
    let cancelled = false;
    refreshSession()
      .then((data) => {
        if (!cancelled) applyAuth(data);
      })
      .catch((err) => {
        // Offline: keep showing the last known user so offline sessions remain possible.
        if (!cancelled && isNetworkError(err)) setUser(cachedUser());
      })
      .finally(() => {
        if (!cancelled) setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [applyAuth]);

  useEffect(
    () =>
      onAuthChange((event) => {
        if (event === "signed-out") {
          setUser(null);
          cacheUser(null);
        }
      }),
    []
  );

  const login = useCallback(
    async (email, password) => {
      try {
        applyAuth(await authApi.login(email.trim(), password));
        return { ok: true };
      } catch (err) {
        return { ok: false, message: errorMessage(err, "Login failed"), fieldErrors: fieldErrors(err) };
      }
    },
    [applyAuth]
  );

  const register = useCallback(
    async (form) => {
      try {
        applyAuth(await authApi.register({ ...form, email: form.email.trim() }));
        return { ok: true };
      } catch (err) {
        return { ok: false, message: errorMessage(err, "Registration failed"), fieldErrors: fieldErrors(err) };
      }
    },
    [applyAuth]
  );

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    clearTokens();
    setUser(null);
    cacheUser(null);
    if (refreshToken) {
      try {
        await authApi.logout(refreshToken); // revoke server-side; best effort
      } catch {
        // already signed out locally
      }
    }
  }, []);

  const updateUser = useCallback((patch) => {
    setUser((u) => {
      const next = u ? { ...u, ...patch } : u;
      cacheUser(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ user, status, login, register, logout, updateUser }), [user, status, login, register, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
