// frontend/src/App.jsx
import React, { useContext } from "react";
import { BrowserRouter, Routes, Route, Link } from "react-router-dom";
import InterviewerRTC from "./components/InterviewerRTC";
import CandidateRTC from "./components/CandidateRTC";
import { AuthProvider, AuthContext } from "./contexts/AuthContext";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import LandingPage from "./pages/LandingPage";
import Navbar from "./components/Navbar";
// don't call useContext at module top-level before provider is mounted

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="bg-gray-900 text-gray-100 w-screen h-screen overflow-x-hidden">
          <Navbar />
          <main className="w-full h-[calc(100%-64.5px)] mx-auto">
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />
              <Route path="/" element={<LandingPage />} />
              <Route path="/interviewer" element={<ProtectedInterviewer />} />

              <Route path="/candidate" element={<CandidateWrapper />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

function ProtectedInterviewer() {
  const { user, sessionId } = useContext(AuthContext);
  if (!user) {
    return (
      <div className="p-6 bg-gray-800 rounded text-gray-300 h-full">
        <h3 className="text-3xl font-bold">Access required</h3>
        <p className="text-xl text-gray-400">
          Please login as an interviewer to access this page.
        </p>
      </div>
    );
  }
  if (user.role !== "interviewer" && user.role !== "admin") {
    return (
      <div className="p-6 bg-gray-800 rounded text-gray-300 h-full">
        <h3 className="text-3xl font-bold">Insufficient permissions</h3>
        <p className="text-xl text-gray-400">
          Your account does not have permission to use the interviewer console.
        </p>
      </div>
    );
  }
  if (!sessionId) {
    return (
      <div className="p-6 bg-gray-800 rounded text-gray-300 h-full">
        <h3 className="text-3xl font-bold">Session ID unknown</h3>
        <p className="text-xl text-gray-400">
          Please create a session on the home page and save the Session ID, or
          paste it into the Session ID field.
        </p>
        <div className="mt-3">
          <a href="/" className="px-3 py-2 bg-indigo-600 rounded text-white">
            Go Home
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-gray-800 rounded h-full">
      <InterviewerRTC
        backendUrl="http://localhost:4000"
        sessionId={sessionId}
        name={user.name || "Interviewer"}
      />
    </div>
  );
}

function CandidateWrapper() {
  const { sessionId } = useContext(AuthContext);
  if (!sessionId) {
    return (
      <div className="p-6 bg-gray-800 h-full rounded text-gray-300">
        <h3 className="text-lg font-medium">Session ID unknown</h3>
        <p className="text-sm text-gray-400">
          Paste the session ID shared by your interviewer on the home page and
          click Save, then come back here.
        </p>
        <div className="mt-3">
          <a href="/" className="px-3 py-2 bg-indigo-600 rounded text-white">
            Go Home
          </a>
        </div>
      </div>
    );
  }
  return (
    <div className="bg-gray-800 rounded h-full">
      <CandidateRTC
        backendUrl="http://localhost:4000"
        sessionId={sessionId}
        name="Candidate B"
      />
    </div>
  );
}
