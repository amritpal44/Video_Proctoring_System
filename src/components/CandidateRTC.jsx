// frontend/src/components/CandidateRTC.jsx
import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function CandidateRTC({
  backendUrl = "http://localhost:4000",
  sessionId,
  name = "Candidate",
}) {
  const localVideoRef = useRef(null);
  const pcRef = useRef(null);
  const socketRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const localStreamRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;

    const socket = io(backendUrl, {
      autoConnect: true,
      reconnectionAttempts: 5,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("socket connect", socket.id);
      socket.emit("join_session", { sessionId, role: "candidate", name });
      setStatus("connected_socket");
    });

    socket.on("session_update", (s) => {
      console.log("session_update", s);
      // If interviewer is connected and candidate is asked to send offer later,
      // interviewer may emit 'request-offer' which we handle below
    });

    socket.on("request-offer", async () => {
      console.log("Received request-offer from interviewer");
      // If we already have local stream and pc, create new offer (re-negotiation)
      if (!localStreamRef.current) {
        // start camera first
        await startLocalStream();
      }
      await createPeerAndSendOffer();
    });

    socket.on("webrtc-answer", async ({ sdp }) => {
      if (!pcRef.current) return;
      console.log("Received answer");
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      setStatus("connected");
    });

    socket.on("webrtc-ice-candidate", async ({ candidate }) => {
      if (!candidate || !pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn("addIceCandidate error", e);
      }
    });

    socket.on("signal_error", (err) => {
      console.warn("signal_error", err);
      setStatus("error:" + (err.msg || "unknown"));
    });

    return () => {
      socket.disconnect();
      stopLocalStream();
      cleanupPeer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function startLocalStream() {
    try {
      const constraints = {
        audio: true,
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      await localVideoRef.current.play();
      // inform server that candidate started streaming
      socketRef.current.emit("stream-started", { sessionId });
      setStatus("streaming");
    } catch (e) {
      console.error("startLocalStream failed", e);
      setStatus("error_stream");
    }
  }

  async function createPeerAndSendOffer() {
    if (!localStreamRef.current) {
      console.warn("no local stream to create offer");
      return;
    }

    // if existing pc exists, close and recreate to avoid stale states
    if (pcRef.current) {
      try {
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    pcRef.current = pc;

    // add tracks
    localStreamRef.current
      .getTracks()
      .forEach((track) => pc.addTrack(track, localStreamRef.current));

    // try to raise bitrate (best-effort)
    try {
      pc.getSenders().forEach((sender) => {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
        // set a higher maxBitrate (2.5 Mbps)
        params.encodings = params.encodings.map((e) => ({
          ...e,
          maxBitrate: 2500000,
        }));
        sender
          .setParameters(params)
          .catch((err) => console.warn("setParameters failed", err));
      });
    } catch (e) {
      console.warn("set senders params failed", e);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current.emit("webrtc-ice-candidate", {
          sessionId,
          candidate: e.candidate,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log("pc connectionState:", pc.connectionState);
      if (pc.connectionState === "connected") setStatus("connected");
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed"
      )
        setStatus("disconnected");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // send offer
    socketRef.current.emit("webrtc-offer", {
      sessionId,
      sdp: pc.localDescription,
    });
    setStatus("offer_sent");
  }

  async function startAndShare() {
    await startLocalStream();
    await createPeerAndSendOffer();
  }

  function stopLocalStream() {
    const s = localStreamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    // inform server that candidate stopped streaming
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit("stream-stopped", { sessionId });
    }
    setStatus("stopped_stream");
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
      <h3>Candidate (session: {sessionId})</h3>
      <video
        ref={localVideoRef}
        autoPlay
        playsInline
        style={{ width: 480, borderRadius: 6, background: "#000" }}
      />
      <div style={{ marginTop: 8 }}>
        <button onClick={startAndShare}>Start & Share Camera</button>
        {/* <button onClick={stopLocalStream} style={{ marginLeft: 8 }}>
          Stop Sharing
        </button> */}
        <span style={{ marginLeft: 12 }}>{status}</span>
      </div>
    </div>
  );
}
