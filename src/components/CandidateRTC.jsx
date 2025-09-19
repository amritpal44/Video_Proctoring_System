import React, { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

import CandidateScreenShare from "./CandidateScreenShare";

/*
  CandidateRTC
  - preserves previous logic (createPeerAndSendOffer, startLocalStream, reconnection)
  - adds: onended/onmute handlers, 2s hardware ping (candidate-health),
          listens to interviewer audio-status -> show error if interviewer mic is off
*/

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
  const pingIntervalRef = useRef(null);

  useEffect(() => {
    if (!sessionId) return;

    const socket = io(backendUrl, {
      autoConnect: true,
      reconnectionAttempts: 5,
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("socket connect", socket.id);
      socket.emit("join_session", { sessionId, role: "candidate", name });
      setStatus("connected_socket");
    });

    socket.on("session_update", (s) => {
      // console.log("session_update", s);
      // If interviewer mic off, show error (we also listen for the explicit event below)
      if (s && s.interviewer && s.interviewer.connected === false) {
        // interviewer offline — this is informational
      }
    });

    // interviewer requested a fresh offer (re-negotiation)
    socket.on("request-offer", async () => {
      console.log("Received request-offer from interviewer");
      if (!localStreamRef.current) {
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

    // interviewer toggles mic => candidate should show error if interviewer mic is off
    socket.on("interviewer-audio-status", ({ sessionId: sid, enabled }) => {
      if (sid !== sessionId) return;
      if (!enabled) {
        // interviewer muted -> per your rule, candidate should see an error
        setStatus("error: interviewer mic OFF");
      } else {
        // clear that specific error only if candidate stream is healthy
        setStatus((s) =>
          s.startsWith("error: interviewer") ? "streaming" : s
        );
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
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
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

      // inform server that candidate started streaming (preserve existing event)
      socketRef.current.emit("stream-started", { sessionId });
      setStatus("streaming");

      // monitor track lifecycle & permission loss
      addTrackListeners(stream);

      // start health ping
      startHealthPing();
    } catch (e) {
      console.error("startLocalStream failed", e);
      setStatus("error_stream");
      // inform server immediately that candidate can't stream
      socketRef.current.emit("stream-stopped", { sessionId });
    }
  }

  function addTrackListeners(stream) {
    // video track listeners
    const videoTracks = stream.getVideoTracks();
    const audioTracks = stream.getAudioTracks();

    videoTracks.forEach((track) => {
      track.onended = () => handleMediaStopped("video");
      track.onmute = () => handleMediaStopped("video");
      track.onunmute = () => {
        // maybe resumed; re-evaluate status
        setStatus("streaming");
        socketRef.current.emit("candidate-health", {
          sessionId,
          healthy: true,
        });
      };
    });

    audioTracks.forEach((track) => {
      track.onended = () => handleMediaStopped("audio");
      track.onmute = () => handleMediaStopped("audio");
      track.onunmute = () => {
        setStatus("streaming");
        socketRef.current.emit("candidate-health", {
          sessionId,
          healthy: true,
        });
      };
    });
  }

  function handleMediaStopped(kind) {
    console.warn("media stopped:", kind);
    // stop local stream & notify server
    stopLocalStream();
    setStatus(`error: ${kind} stopped or permission removed`);
    socketRef.current.emit("stream-stopped", { sessionId });
    socketRef.current.emit("candidate-health", { sessionId, healthy: false });
  }

  function startHealthPing() {
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    pingIntervalRef.current = setInterval(() => {
      const s = localStreamRef.current;
      const videoTrack = s?.getVideoTracks()?.[0];
      const audioTrack = s?.getAudioTracks()?.[0];

      const videoLive =
        !!videoTrack &&
        videoTrack.readyState === "live" &&
        videoTrack.enabled !== false;
      const audioLive =
        !!audioTrack &&
        audioTrack.readyState === "live" &&
        audioTrack.enabled !== false;
      const healthy = videoLive && audioLive;

      socketRef.current.emit("candidate-health", { sessionId, healthy });

      if (!healthy) {
        // if something is wrong, handle immediately
        handleMediaStopped("camera/mic");
      }
    }, 2000);
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

    // add tracks (audio + video)
    localStreamRef.current
      .getTracks()
      .forEach((track) => pc.addTrack(track, localStreamRef.current));

    // try to raise bitrate (best-effort)
    try {
      pc.getSenders().forEach((sender) => {
        const params = sender.getParameters();
        if (!params.encodings) params.encodings = [{}];
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

    // send offer (preserve event name)
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
      socketRef.current.emit("candidate-health", { sessionId, healthy: false });
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
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-950 to-gray-900 py-8 px-2">
      <div className="w-full max-w-2xl bg-gray-800/90 rounded-2xl shadow-2xl p-8 border border-gray-700 flex flex-col items-center">
        <h3 className="text-2xl font-bold text-white mb-6">
          Candidate{" "}
          <span className="text-base font-mono text-indigo-300">
            (session: {sessionId})
          </span>
        </h3>
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          className="w-full max-w-lg aspect-video rounded-xl bg-black border border-gray-700 shadow mb-6"
        />
        <div className="w-full flex flex-col items-center">
          <button onClick={startAndShare}>Start & Share Camera</button>
          <CandidateScreenShare
            pcRef={pcRef}
            socketRef={socketRef}
            sessionId={sessionId}
          />
          {/* preserve your commented-out stop button — candidate should NOT have explicit off per requirement */}
          <span className="mt-2 text-base text-gray-300 font-semibold">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}
