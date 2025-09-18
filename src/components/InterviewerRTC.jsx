// frontend/src/components/InterviewerRTC.jsx
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

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

  useEffect(() => {
    if (!sessionId) return;
    const socket = io(backendUrl, {
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("socket connected", socket.id);
      socket.emit("join_session", { sessionId, role: "interviewer", name });
      setStatus("connected_socket");
    });

    socket.on("session_update", (s) => {
      console.log("session_update", s);
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

    socket.on("signal_error", (err) => {
      console.warn("signal_error", err);
      setStatus("error:" + (err.msg || "unknown"));
    });

    return () => {
      socket.disconnect();
      cleanupPeer();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  function handleSessionUpdate(s) {
    // If candidate is connected but not streaming, and interviewer is connected -> ask candidate to send offer
    if (s && s.candidate && s.candidate.connected && !s.candidate.streaming) {
      // Ask candidate to re-offer (useful after interviewer refresh)
      console.log("Candidate connected but not streaming -> requesting offer");
      socketRef.current.emit("request-offer", { sessionId });
    }

    // If candidate disconnected -> tear down pc & UI
    if (s && (!s.candidate || !s.candidate.connected)) {
      console.log("Candidate disconnected -> cleaning up PC");
      setStatus("candidate_offline");
      cleanupPeer();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    }
  }

  async function handleOffer(remoteSdp) {
    if (!pcRef.current) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      pcRef.current = pc;

      pc.ontrack = (e) => {
        try {
          remoteVideoRef.current.srcObject = e.streams[0];
          remoteVideoRef.current.play().catch(() => {});
          setStatus("streaming");
        } catch (err) {
          console.warn("ontrack error", err);
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
  }

  return (
    <div>
      <h3>Interviewer (session: {sessionId})</h3>
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={{ width: 640, borderRadius: 6, background: "#000" }}
      />
      <div style={{ marginTop: 8 }}>
        <span style={{ marginRight: 12 }}>Status: {status}</span>
        <button
          onClick={() => {
            // manual re-request in case of stale state
            if (socketRef.current && socketRef.current.connected)
              socketRef.current.emit("request-offer", { sessionId });
          }}
        >
          Request Offer
        </button>
        <button
          onClick={() => {
            // force cleanup
            cleanupPeer();
            setStatus("cleaned");
          }}
          style={{ marginLeft: 8 }}
        >
          Reset Connection
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <pre style={{ background: "#f3f3f3", padding: 8 }}>
          {JSON.stringify(sessionState, null, 2)}
        </pre>
      </div>
    </div>
  );
}
