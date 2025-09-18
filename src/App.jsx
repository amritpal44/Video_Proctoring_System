// frontend/src/App.jsx
import React from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import InterviewerRTC from "./components/InterviewerRTC";
import CandidateRTC from "./components/CandidateRTC";

function App() {
  const sessionId = "EEodO7RlkW9M";
  return (
    <BrowserRouter>
      <div>
        <nav style={{ marginBottom: "20px", padding: "10px" }}>
          <Link to="/interviewer" style={{ marginRight: "20px" }}>
            Interviewer Page
          </Link>
          <Link to="/candidate">Candidate Page</Link>
        </nav>

        <Routes>
          <Route
            path="/interviewer"
            element={
              <div style={{ padding: 20 }}>
                <InterviewerRTC
                  backendUrl="http://localhost:4000"
                  sessionId={sessionId}
                  name="Interviewer A"
                />
              </div>
            }
          />
          <Route
            path="/candidate"
            element={
              <div style={{ padding: 20 }}>
                <CandidateRTC
                  backendUrl="http://localhost:4000"
                  sessionId={sessionId}
                  name="Candidate B"
                />
              </div>
            }
          />
          <Route
            path="/"
            element={
              <div style={{ padding: 20 }}>
                <h1>Welcome to Video Proctoring System</h1>
                <p>Please select your role:</p>
                <Link
                  to="/interviewer"
                  style={{ display: "block", marginBottom: "10px" }}
                >
                  Join as Interviewer
                </Link>
                <Link to="/candidate">Join as Candidate</Link>
              </div>
            }
          />
        </Routes>
      </div>
    </BrowserRouter>
  );
}
export default App;
