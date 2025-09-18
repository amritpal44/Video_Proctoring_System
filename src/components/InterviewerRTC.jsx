import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

/*
 InterviewerRTC
 - preserves previous logic (handleOffer, create peer & answer)
 - adds: getUserMedia(audio only) for interviewer mic
 - interviewer can toggle mic on/off (sends interviewer-audio-status)
 - when handling offer, add local audio track (if interviewer allowed mic)
 - when interviewer toggles mic, emit event so candidate gets notified
*/

export default function InterviewerRTC({
  backendUrl = "http://localhost:4000",
  sessionId,
  name = "Interviewer",
}) {
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [sessionState, setSessionState] = useState(null);
  const [micOn, setMicOn] = useState(true);
  const localAudioStreamRef = useRef(null);

  const remoteScreenRef = useRef(null);
  const [isVideoMain, setIsVideoMain] = useState(true);
  const [screenActive, setScreenActive] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    const socket = io(backendUrl, {
      autoConnect: true,
      reconnectionAttempts: 5,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("socket connected", socket.id);
      socket.emit("join_session", { sessionId, role: "interviewer", name });
      setStatus("connected_socket");
    });

    socket.on("session_update", (s) => {
      // console.log("session_update", s);
      setSessionState(s);
      handleSessionUpdate(s);
    });

    socket.on("webrtc-offer", async ({ sdp }) => {
      console.log("Received offer");
      await handleOffer(sdp);
    });

    socket.on("webrtc-ice-candidate", async ({ candidate }) => {
      if (!candidate || !pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("addIce error", e);
      }
    });

    socket.on("candidate-health", ({ sessionId: sid, healthy }) => {
      if (sid !== sessionId) return;
      // show candidate health status in UI
      setSessionState((prev) => ({ ...prev, candidateHealth: healthy }));
    });

    socket.on("signal_error", (err) => {
      console.warn("signal_error", err);
      setStatus("error:" + (err.msg || "unknown"));
    });

    socket.on("candidate_screen_stop", ({ sessionId: sid }) => {
      if (sid !== sessionId) return;
      if (remoteScreenRef.current) {
        const stream = remoteScreenRef.current.srcObject;
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          remoteScreenRef.current.srcObject = null;
        }
        setScreenActive(false);
      }
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      // stop interviewer mic
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach((t) => t.stop());
        localAudioStreamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function handleSessionUpdate(s) {
    // Update screen sharing state based on session
    if (s && s.candidate) {
      if (s.candidate.screenSharing && !screenActive) {
        setScreenActive(true);
        // Request a new offer to get the screen share track
        socketRef.current.emit("request-offer", { sessionId });
      } else if (!s.candidate.screenSharing && screenActive) {
        setScreenActive(false);
        if (remoteScreenRef.current) {
          remoteScreenRef.current.srcObject = null;
        }
      }
    }

    // If candidate is connected but not streaming, ask candidate to send offer
    if (s && s.candidate && s.candidate.connected && !s.candidate.streaming) {
      console.log("Candidate connected but not streaming -> requesting offer");
      socketRef.current.emit("request-offer", { sessionId });
    }

    // If candidate disconnected -> tear down pc & UI
    if (s && (!s.candidate || !s.candidate.connected)) {
      console.log("Candidate disconnected -> cleaning up PC");
      setStatus("candidate_offline");
      cleanupPeer();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
      if (remoteScreenRef.current) remoteScreenRef.current.srcObject = null;
      setScreenActive(false);
    }
  }

  async function ensureLocalAudio() {
    if (localAudioStreamRef.current) {
      // already captured; just ensure track.enabled matches micOn
      localAudioStreamRef.current
        .getAudioTracks()
        .forEach((t) => (t.enabled = micOn));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localAudioStreamRef.current = stream;
      // ensure enabled/disabled based on micOn
      localAudioStreamRef.current
        .getAudioTracks()
        .forEach((t) => (t.enabled = micOn));
    } catch (e) {
      console.warn("Interviewer mic access failed", e);
      setStatus("mic_access_error");
    }
  }

  // interviewer toggles mic on/off
  async function toggleMic() {
    const newState = !micOn;
    setMicOn(newState);
    // ensure we have a local audio stream
    await ensureLocalAudio();
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current
        .getAudioTracks()
        .forEach((t) => (t.enabled = newState));
    }
    // notify candidate about interviewer mic status
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("interviewer-audio-status", {
        sessionId,
        enabled: newState,
      });
    }
  }

  async function handleOffer(remoteSdp) {
    if (!pcRef.current) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      // if interviewer wants to send audio, ensure local audio captured and add tracks now
      await ensureLocalAudio();
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getAudioTracks().forEach((track) => {
          pc.addTrack(track, localAudioStreamRef.current);
        });
      }

      pc.ontrack = (e) => {
        const track = e.track;
        const stream = e.streams[0];

        console.log("ontrack:", track.kind, track.label);

        if (
          track.kind === "video" &&
          track.label.toLowerCase().includes("screen")
        ) {
          // This is candidate's shared screen
          if (!remoteScreenRef.current.srcObject) {
            remoteScreenRef.current.srcObject = new MediaStream();
          }
          remoteScreenRef.current.srcObject.addTrack(track);
          remoteScreenRef.current.play().catch(() => {});
          setScreenActive(true);
        } else if (track.kind === "video") {
          // This is candidate's webcam video
          if (!remoteVideoRef.current.srcObject) {
            remoteVideoRef.current.srcObject = new MediaStream();
          }
          remoteVideoRef.current.srcObject.addTrack(track);
          remoteVideoRef.current.play().catch(() => {});
          setStatus("streaming");
        } else if (track.kind === "audio") {
          // Audio tracks just get added to the main remote video
          if (!remoteVideoRef.current.srcObject) {
            remoteVideoRef.current.srcObject = new MediaStream();
          }
          remoteVideoRef.current.srcObject.addTrack(track);
        }
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          socketRef.current.emit("webrtc-ice-candidate", {
            sessionId,
            candidate: e.candidate,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("pc connectionState:", pcRef.current.connectionState);
        if (pcRef.current.connectionState === "connected")
          setStatus("connected");
        if (
          pcRef.current.connectionState === "disconnected" ||
          pcRef.current.connectionState === "failed"
        )
          setStatus("disconnected");
      };
    }

    // set remote description and create answer
    await pcRef.current.setRemoteDescription(
      new RTCSessionDescription(remoteSdp)
    );
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);

    socketRef.current.emit("webrtc-answer", {
      sessionId,
      sdp: pcRef.current.localDescription,
    });
    setStatus("answered");
  }

  function cleanupPeer() {
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }
    // Clean up video streams
    if (remoteVideoRef.current && remoteVideoRef.current.srcObject) {
      remoteVideoRef.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
      remoteVideoRef.current.srcObject = null;
    }
    if (remoteScreenRef.current && remoteScreenRef.current.srcObject) {
      remoteScreenRef.current.srcObject
        .getTracks()
        .forEach((track) => track.stop());
      remoteScreenRef.current.srcObject = null;
    }
    setScreenActive(false);
  }

  return (
    <div className="w-full h-full flex flex-col md:flex-row items-stretch justify-center bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 p-4 md:p-8 gap-8">
      <main className="flex-1 flex flex-col items-center justify-center max-w-3xl mx-auto">
        <div className="w-full bg-black rounded-2xl overflow-hidden shadow-2xl border border-gray-800">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-[60vh] object-contain bg-black"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-6 w-full justify-center">
          <button
            onClick={() => setIsVideoMain(!isVideoMain)}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-100 font-medium shadow"
          >
            Swap Focus
          </button>
          <button
            onClick={() => {
              if (socketRef.current && socketRef.current.connected)
                socketRef.current.emit("request-offer", { sessionId });
            }}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-semibold shadow"
          >
            Request Offer
          </button>
          <button
            onClick={() => {
              cleanupPeer();
              setStatus("cleaned");
            }}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-100 font-medium shadow"
          >
            Reset
          </button>
          <button
            onClick={toggleMic}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-gray-100 font-medium shadow"
          >
            {micOn ? "Mute Mic" : "Unmute Mic"}
          </button>
        </div>
        <div className="mt-5">
          <StatusPill status={status} />
        </div>
      </main>

      <aside className="w-full md:w-[400px] bg-gray-800/90 rounded-2xl shadow-2xl p-8 border border-gray-700 flex flex-col gap-6 mx-auto">
        <div>
          <h4 className="text-2xl font-bold text-white mb-4 tracking-tight">
            Session Details
          </h4>
          <div className="text-base text-gray-300 space-y-1">
            <p>
              <span className="text-gray-400">Session ID:</span>{" "}
              <span className="font-mono text-indigo-300">{sessionId}</span>
            </p>
            <p>
              <span className="text-gray-400">Interview ID:</span>{" "}
              <span className="font-mono">
                {sessionState?.interviewId || "—"}
              </span>
            </p>
            <p>
              <span className="text-gray-400">Last update:</span>{" "}
              {sessionState?.lastUpdate
                ? new Date(sessionState.lastUpdate).toLocaleString()
                : "—"}
            </p>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-700">
          <h5 className="text-lg text-gray-300 mb-2 font-semibold">
            Interviewer
          </h5>
          {sessionState?.interviewer ? (
            <div className="text-base text-gray-200">
              <p className="font-medium">{sessionState.interviewer.name}</p>
              <p className="text-gray-400">
                {sessionState.interviewer.connected
                  ? "Connected"
                  : "Disconnected"}
              </p>
            </div>
          ) : (
            <div className="text-base text-gray-500">
              No interviewer in session
            </div>
          )}
        </div>

        <div className="pt-2 border-t border-gray-700">
          <h5 className="text-lg text-gray-300 mb-2 font-semibold">
            Candidate
          </h5>
          {sessionState?.candidate ? (
            <div className="text-base text-gray-200">
              <p className="font-medium">{sessionState.candidate.name}</p>
              <p className="text-gray-400">
                {sessionState.candidate.connected
                  ? "Connected"
                  : "Disconnected"}
              </p>
              <p className="text-gray-400">
                Streaming: {sessionState.candidate.streaming ? "Yes" : "No"}
              </p>
            </div>
          ) : (
            <div className="text-base text-gray-500">
              No candidate in session
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-gray-700">
          <h5 className="text-base text-gray-300 mb-2 font-semibold">Logs</h5>
          <pre className="text-xs text-gray-300 bg-gray-900/80 p-3 rounded-lg max-h-40 overflow-auto border border-gray-700">
            {JSON.stringify(sessionState, null, 2)}
          </pre>
        </div>
      </aside>
    </div>
  );
}

function StatusPill({ status }) {
  let color = "bg-gray-600 text-gray-100";
  let label = status;
  if (!status) {
    label = "idle";
  } else if (status.startsWith("error")) {
    color = "bg-red-600 text-white";
    label = status.replace("error:", "").trim();
  } else if (status === "connected" || status === "streaming") {
    color = "bg-green-600 text-white";
    label = status;
  } else if (
    status === "connected_socket" ||
    status === "answered" ||
    status === "offer_sent"
  ) {
    color = "bg-indigo-600 text-white";
  }

  return <span className={`px-3 py-1 rounded ${color} text-sm`}>{label}</span>;
}
