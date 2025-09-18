import React, { createContext, useState, useEffect } from "react";

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [sessionId, setSessionId] = useState(() => {
    try {
      return window.localStorage.getItem("hd_session_id") || "";
    } catch (e) {
      return "";
    }
  });
  const backend = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";

  useEffect(() => {
    // try to fetch current user
    fetch(`${backend}/api/auth/me`, { credentials: "include" })
      .then((r) => r.json())
      .then((j) => {
        if (j && j.user) setUser(j.user);
      })
      .catch(() => {});
  }, []);

  const login = async (email, password) => {
    const res = await fetch(`${backend}/api/auth/login`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const j = await res.json();
    if (res.ok && j.user) {
      setUser(j.user);
      return { ok: true };
    }
    return { ok: false, error: j.error };
  };

  const logout = async () => {
    await fetch(`${backend}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
  };

  // persist sessionId locally so candidate can refresh and keep the id
  useEffect(() => {
    try {
      if (sessionId) window.localStorage.setItem("hd_session_id", sessionId);
      else window.localStorage.removeItem("hd_session_id");
    } catch (e) {}
  }, [sessionId]);

  return (
    <AuthContext.Provider
      value={{ user, login, logout, sessionId, setSessionId }}
    >
      {children}
    </AuthContext.Provider>
  );
}
