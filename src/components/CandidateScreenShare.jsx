import React, { useRef, useState } from "react";

export default function CandidateScreenShare({ pcRef, socketRef, sessionId }) {
  const screenStreamRef = useRef(null);
  const [sharing, setSharing] = useState(false);

  async function startScreenShare() {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      screenStreamRef.current = screenStream;

      screenStream.getTracks().forEach((track) => {
        pcRef.current.addTrack(track, screenStream);
      });

      socketRef.current.emit("candidate_screen_start", { sessionId });
      setSharing(true);

      // handle if user clicks "Stop sharing" from browser bar
      screenStream.getVideoTracks()[0].onended = () => stopScreenShare();
    } catch (e) {
      console.error("Screen share failed", e);
    }
  }

  function stopScreenShare() {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    socketRef.current.emit("candidate_screen_stop", { sessionId });
    setSharing(false);
  }

  return (
    <div style={{ marginTop: 12 }}>
      {!sharing ? (
        <button onClick={startScreenShare}>Start Screen Share</button>
      ) : (
        <button onClick={stopScreenShare}>Stop Screen Share</button>
      )}
    </div>
  );
}
