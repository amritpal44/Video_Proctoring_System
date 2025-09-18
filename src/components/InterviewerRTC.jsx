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
    <div>
      <h3>Interviewer (session: {sessionId})</h3>
      {/* <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        style={{ width: "50%", borderRadius: 6, background: "#000" }}
      />
      <video
        ref={remoteScreenRef}
        autoPlay
        playsInline
        style={{
          width: "50%",
          borderRadius: 6,
          background: "#000",
          display: screenActive ? "block" : "none",
        }}
      /> */}

      <div
        style={{
          display: "flex",
          gap: "16px",
          maxWidth: "100%",
          height: "auto",
        }}
      >
        <div
          style={{
            width: isVideoMain ? "70%" : "30%",
            minWidth: "300px",
            maxWidth: screenActive ? "70%" : "100%",
          }}
        >
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              height: "auto",
              maxHeight: "70vh",
              borderRadius: 6,
              background: "#000",
              objectFit: "contain",
            }}
          />
        </div>
        {screenActive && (
          <div
            style={{
              width: isVideoMain ? "30%" : "70%",
              minWidth: "300px",
            }}
          >
            <video
              ref={remoteScreenRef}
              autoPlay
              playsInline
              style={{
                width: "100%",
                height: "auto",
                maxHeight: "70vh",
                borderRadius: 6,
                background: "#000",
                objectFit: "contain",
              }}
            />
          </div>
        )}
      </div>

      {screenActive && (
        <button
          onClick={() => setIsVideoMain(!isVideoMain)}
          style={{ marginTop: 8 }}
        >
          Swap Focus
        </button>
      )}

      <div style={{ marginTop: 8 }}>
        <span style={{ marginRight: 12 }}>Status: {status}</span>
        <button
          onClick={() => {
            if (socketRef.current && socketRef.current.connected)
              socketRef.current.emit("request-offer", { sessionId });
          }}
        >
          Request Offer
        </button>
        <button
          onClick={() => {
            cleanupPeer();
            setStatus("cleaned");
          }}
          style={{ marginLeft: 8 }}
        >
          Reset Connection
        </button>

        <button onClick={toggleMic} style={{ marginLeft: 12 }}>
          {micOn ? "Mute Mic" : "Unmute Mic"}
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <pre style={{ background: "#202022ff", padding: 8 }}>
          {JSON.stringify(sessionState, null, 2)}
        </pre>
      </div>
    </div>
  );
}
