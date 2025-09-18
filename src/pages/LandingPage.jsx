import React, { useContext, useState } from "react";
import { AuthContext } from "../contexts/AuthContext";
import { useNavigate } from "react-router-dom";

export default function LandingPage() {
  const { user } = useContext(AuthContext);
  const { sessionId: ctxSessionId, setSessionId: setCtxSessionId } =
    useContext(AuthContext);
  const [sessionId, setSessionId] = useState(ctxSessionId || "");
  const [created, setCreated] = useState(null);
  const backend = import.meta.env.VITE_BACKEND_URL || "http://localhost:4000";
  const navigate = useNavigate();
  const [error, setError] = useState("");

  const createSession = async () => {
    const name = user ? user.name || "Interviewer" : "Interviewer";
    const res = await fetch(`${backend}/api/sessions/create`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerName: name }),
    });
    const j = await res.json();
    if (res.ok) {
      setCreated(j.sessionId);
      setSessionId(j.sessionId);
      if (setCtxSessionId) setCtxSessionId(j.sessionId);
    } else {
      alert(j.error || "failed");
    }
  };

  const saveSessionToContext = () => {
    if (setCtxSessionId) setCtxSessionId(sessionId);
    alert("Session ID saved for this browser");
  };

  const joinSessionAsCandidate = async () => {
    setError("");
    if (!sessionId) return setError("Please enter a session ID");
    try {
      const res = await fetch(`${backend}/api/sessions/${sessionId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("Session not found");
        return;
      }
      const j = await res.json();
      // store session and go to candidate console
      if (setCtxSessionId) setCtxSessionId(sessionId);
      navigate("/candidate");
    } catch (e) {
      setError("Network error");
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-12">
      <div className="bg-gray-800 rounded-lg p-6 shadow-md">
        <h1 className="text-2xl font-semibold text-white mb-2">
          Welcome to HireDude
        </h1>
        <p className="text-gray-300 mb-4">
          Create and manage interview sessions with live proctoring.
        </p>

        {user ? (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-gray-200">
                  Signed in as <span className="font-medium">{user.name}</span>
                </p>
                <p className="text-sm text-gray-400">Role: {user.role}</p>
              </div>
            </div>

            {user.role === "interviewer" || user.role === "admin" ? (
              <div className="bg-gray-900 rounded p-4">
                <button
                  onClick={createSession}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded text-white"
                >
                  Create Interview Session
                </button>
                {created && (
                  <div className="mt-3 text-sm text-gray-300">
                    <p>
                      Session created:{" "}
                      <span className="font-mono text-indigo-300">
                        {created}
                      </span>
                    </p>
                    <p>Share this id with candidate to join.</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => navigate("/interviewer")}
                        className="px-3 py-1 bg-indigo-600 rounded text-white"
                      >
                        Open Interview Console
                      </button>
                      <button
                        onClick={() => navigator.clipboard?.writeText(created)}
                        className="px-3 py-1 bg-gray-700 rounded text-white"
                      >
                        Copy ID
                      </button>
                    </div>
                  </div>
                )}
                <div className="mt-3">
                  <label className="block text-sm text-gray-300">
                    Session ID
                  </label>
                  <div className="flex gap-2 mt-2">
                    <input
                      value={sessionId}
                      onChange={(e) => setSessionId(e.target.value)}
                      className="w-full bg-gray-700 text-white px-3 py-2 rounded"
                      placeholder="paste or enter session id"
                    />
                    <button
                      onClick={saveSessionToContext}
                      className="px-3 py-2 bg-green-600 rounded text-white"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-400">
                Only interviewers can create sessions.
              </p>
            )}
            {/* Candidate: allow joining by session id */}
            {user && user.role === "candidate" && (
              <div className="bg-gray-900 rounded p-4 mt-4">
                <label className="block text-sm text-gray-300">
                  Enter Session ID to join
                </label>
                <div className="flex gap-2 mt-2">
                  <input
                    value={sessionId}
                    onChange={(e) => setSessionId(e.target.value)}
                    className="w-full bg-gray-700 text-white px-3 py-2 rounded"
                    placeholder="session id"
                  />
                  <button
                    onClick={joinSessionAsCandidate}
                    className="px-3 py-2 bg-indigo-600 rounded text-white"
                  >
                    Join
                  </button>
                </div>
                {error && <p className="text-red-400 mt-2">{error}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 bg-gray-900 rounded">
            <p className="text-gray-300">
              Please{" "}
              <a
                className="text-indigo-400 hover:text-indigo-300"
                href="/login"
              >
                login
              </a>{" "}
              or{" "}
              <a
                className="text-indigo-400 hover:text-indigo-300"
                href="/signup"
              >
                signup
              </a>{" "}
              to create a session.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
