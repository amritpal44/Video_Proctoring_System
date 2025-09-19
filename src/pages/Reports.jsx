import React, { useEffect, useState, useContext } from "react";
import { AuthContext } from "../contexts/AuthContext";

export default function ReportsPage() {
  const { user } = useContext(AuthContext);
  const [interviews, setInterviews] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [minScore, setMinScore] = useState(75);

  useEffect(() => {
    if (!user) return;
    fetchInterviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function fetchInterviews() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQ) params.set("q", searchQ);
      if (startDate) params.set("from", startDate);
      if (endDate) params.set("to", endDate);
      if (minScore) params.set("minScore", String(minScore));

      const url =
        `${
          import.meta.env.VITE_BACKEND_URL || "http://localhost:4000"
        }/api/proctor/interviews?` + params.toString();
      const res = await fetch(url, { credentials: "include" });
      const j = await res.json();
      if (res.ok) setInterviews(j.interviews || []);
    } catch (e) {
      console.warn("fetchInterviews failed", e);
    } finally {
      setLoading(false);
    }
  }

  function doSearch() {
    fetchInterviews();
  }

  async function downloadCSV(interviewId, sessionId, candidateName) {
    try {
      const url = `${
        import.meta.env.VITE_BACKEND_URL || "http://localhost:4000"
      }/api/proctor/report/${interviewId}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        alert("Failed to generate report: " + (j?.error || res.statusText));
        return;
      }
      const payload = await res.json();
      // Convert JSON report to CSV rows
      const rows = [];
      rows.push(["Interview ID", payload.report.interview.id]);
      rows.push(["Session ID", payload.report.interview.sessionId]);
      rows.push(["Title", payload.report.interview.title || ""]);
      rows.push(["Candidate", payload.report.candidate?.name || ""]);
      rows.push(["Interviewer", payload.report.interviewer?.name || ""]);
      rows.push(["Start Time", payload.report.interview.startTime || ""]);
      rows.push(["End Time", payload.report.interview.endTime || ""]);
      rows.push(["Duration", payload.report.interview.duration || ""]);
      rows.push(["Integrity Score", payload.report.integrityScore]);
      rows.push([]);
      rows.push(["Timeline: timestamp", "type", "severity", "details"]);
      // timeline timestamps may already be formatted strings (IST). Be tolerant.
      payload.report.eventTimeline.forEach((e) => {
        let ts = e.timestamp;
        try {
          if (typeof ts === "string") {
            // assume formatted already (e.g., '19 Sep 2025, 20:34:12 IST')
            // use as-is
          } else if (ts) {
            const d = new Date(ts);
            if (!isNaN(d)) ts = d.toISOString();
            else ts = String(e.timestamp);
          } else ts = "";
        } catch (err) {
          ts = String(e.timestamp);
        }

        rows.push([ts, e.type, e.severity, JSON.stringify(e.details || "")]);
      });

      const csv = rows
        .map((r) => r.map((c) => `"${(c + "").replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob([csv], { type: "text/csv" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${(candidateName || sessionId || interviewId).replace(
        /[^a-z0-9-_\.]/gi,
        "_"
      )}_report.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      console.error("downloadCSV error", e);
      alert("Failed to download report");
    }
  }

  if (!user) {
    return (
      <div className="p-6 bg-gray-800 rounded text-gray-300 h-full">
        <h3 className="text-3xl font-bold">Access required</h3>
        <p className="text-xl text-gray-400">Please login to view reports.</p>
      </div>
    );
  }

  if (user.role !== "interviewer" && user.role !== "admin") {
    return (
      <div className="p-6 bg-gray-800 rounded text-gray-300 h-full">
        <h3 className="text-3xl font-bold">Insufficient permissions</h3>
        <p className="text-xl text-gray-400">
          You don't have access to reports.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold text-white mb-4">
        Interviews & Reports
      </h2>
      <div className="bg-gray-800 rounded p-4">
        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 items-end mb-4">
          <input
            placeholder="Search sessionId, title, candidate or email"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="px-3 py-2 rounded bg-gray-700 text-white border border-gray-600 w-64"
          />
          <div>
            <label className="text-xs text-gray-300 block">Start</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-2 rounded bg-gray-700 text-white border border-gray-600"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 block">End</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-2 rounded bg-gray-700 text-white border border-gray-600"
            />
          </div>
          <div>
            <label className="text-xs text-gray-300 block">Min Score</label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-20 px-3 py-2 rounded bg-gray-700 text-white border border-gray-600"
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={doSearch}
              className="px-3 py-2 bg-indigo-600 text-white rounded"
            >
              Search
            </button>
            <button
              onClick={() => {
                // reset to defaults
                setSearchQ("");
                const d = new Date();
                d.setDate(d.getDate() - 7);
                setStartDate(d.toISOString().slice(0, 10));
                setEndDate(new Date().toISOString().slice(0, 10));
                setMinScore(75);
                setTimeout(() => fetchInterviews(), 50);
              }}
              className="px-3 py-2 bg-gray-600 text-white rounded"
            >
              Reset
            </button>
          </div>
        </div>
        {loading ? (
          <div className="text-gray-300">Loading...</div>
        ) : (
          <div className="space-y-3">
            {interviews.length === 0 && (
              <div className="text-gray-400">No interviews found.</div>
            )}
            {interviews.map((iv) => (
              <div
                key={iv._id}
                className="flex items-center justify-between bg-gray-900/60 p-3 rounded"
              >
                <div>
                  <div className="text-white font-semibold">
                    {iv.title || iv.sessionId}
                  </div>
                  <div className="text-gray-400 text-sm">
                    Session: <span className="font-mono">{iv.sessionId}</span>
                  </div>
                  <div className="text-gray-400 text-sm">
                    Candidate: {iv.candidate?.name || "—"}
                  </div>
                  <div className="text-gray-400 text-sm">
                    Score: {iv.integrityScore ?? "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      downloadCSV(iv._id, iv.sessionId, iv.candidate?.name)
                    }
                    className="px-3 py-1 bg-indigo-600 text-white rounded"
                  >
                    Download CSV
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
