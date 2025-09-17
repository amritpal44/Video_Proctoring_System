// src/components/InterviewScreen.jsx
import React, { useRef, useEffect, useState } from "react";
import "@tensorflow/tfjs-backend-webgl";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";

/*
  Usage:
  <InterviewScreen candidateName="Amritpal Singh" backendUrl="http://localhost:4000" />
*/

export default function InterviewScreen({
  candidateName = "Candidate",
  backendUrl = "http://localhost:4000",
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const detectionIntervalRef = useRef(null);

  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [events, setEvents] = useState([]); // local event logs
  const [objectModel, setObjectModel] = useState(null);
  const [faceDetector, setFaceDetector] = useState(null);

  // timestamps for heuristics
  const lastFaceSeenTsRef = useRef(Date.now());
  const lastLookingCenterTsRef = useRef(Date.now());

  // thresholds (tweak as needed)
  const ABSENCE_MS = 10000; // no face >10s
  const AWAY_MS = 5000; // looking away >5s
  const CENTER_THRESHOLD = 0.2; // fraction of width/height for "center"

  useEffect(() => {
    let mounted = true;
    async function init() {
      await tf.setBackend("webgl");

      // load object detection (COCO-SSD)
      const objModel = await cocoSsd.load();
      // load face-landmarks (MediaPipe FaceMesh via tfjs)
      const fd = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        {
          runtime: "tfjs",
          modelType: "short", // use 'short' or 'full' depending on perf
        }
      );

      if (!mounted) return;
      setObjectModel(objModel);
      setFaceDetector(fd);
      setModelsLoaded(true);
      addEvent("model_loaded", "Models loaded and ready");
    }
    init();

    startCamera().catch((err) => {
      console.error("Camera start failed", err);
      addEvent("error", "Camera access failed");
    });

    return () => {
      mounted = false;
      stopCamera();
      stopDetectionLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // start webcam
  async function startCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: true,
    });
    videoRef.current.srcObject = stream;
    await videoRef.current.play();
  }

  function stopCamera() {
    const stream = videoRef.current?.srcObject;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
  }

  // small helper to push events locally and POST to backend
  function addEvent(type, detail) {
    const ev = { type, detail, ts: new Date().toISOString() };
    setEvents((prev) => {
      const next = [...prev, ev];
      // send asynchronously (fire & forget)
      fetch(`${backendUrl}/api/logs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateName, event: ev }),
      }).catch((e) => console.warn("log send failed", e));
      return next;
    });
  }

  // detection loop (runs periodically to save CPU)
  function startDetectionLoop() {
    if (!objectModel || !faceDetector) return;
    stopDetectionLoop();
    detectionIntervalRef.current = setInterval(async () => {
      try {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        const vw = video.videoWidth,
          vh = video.videoHeight;
        // face detection / landmarks
        const faces = await faceDetector.estimateFaces(video);

        // draw overlay
        const ctx = canvasRef.current.getContext("2d");
        canvasRef.current.width = vw;
        canvasRef.current.height = vh;
        ctx.clearRect(0, 0, vw, vh);
        ctx.strokeStyle = "lime";
        ctx.lineWidth = 2;

        if (!faces || faces.length === 0) {
          // no face present
          if (Date.now() - lastFaceSeenTsRef.current > ABSENCE_MS) {
            addEvent("no_face", `No face present for > ${ABSENCE_MS / 1000}s`);
            // reset to avoid repeated logs
            lastFaceSeenTsRef.current = Date.now();
          }
        } else {
          // face(s) detected
          lastFaceSeenTsRef.current = Date.now();
          // log multiple faces
          if (faces.length > 1) {
            addEvent(
              "multiple_faces",
              `Multiple faces detected: ${faces.length}`
            );
          }
          faces.forEach((f) => {
            // compute face center as average of keypoints
            const kps = f.keypoints || f.scaledMesh || [];
            let cx = 0,
              cy = 0;
            if (kps.length) {
              kps.forEach((p) => {
                // support different formats
                if (p.x !== undefined) {
                  cx += p.x;
                  cy += p.y;
                } else {
                  cx += p[0];
                  cy += p[1];
                }
              });
              cx /= kps.length;
              cy /= kps.length;
            } else if (f.box) {
              const [x, y, w, h] = f.box;
              cx = x + w / 2;
              cy = y + h / 2;
            }

            // draw a box/center
            ctx.beginPath();
            if (f.box) {
              const [x, y, w, h] = f.box;
              ctx.rect(x, y, w, h);
            } else {
              ctx.arc(cx, cy, 30, 0, Math.PI * 2);
            }
            ctx.stroke();

            // check if face center is near frame center
            const dx = Math.abs(cx - vw / 2) / vw;
            const dy = Math.abs(cy - vh / 2) / vh;
            if (dx < CENTER_THRESHOLD && dy < CENTER_THRESHOLD) {
              lastLookingCenterTsRef.current = Date.now();
            } else {
              // if away too long -> flag
              if (Date.now() - lastLookingCenterTsRef.current > AWAY_MS) {
                addEvent(
                  "looking_away",
                  `User looking away for > ${AWAY_MS / 1000}s (dx=${dx.toFixed(
                    2
                  )},dy=${dy.toFixed(2)})`
                );
                lastLookingCenterTsRef.current = Date.now();
              }
            }
          });
        }

        // object detection (lightweight)
        const objects = await objectModel.detect(video);
        // filter for suspicious classes; names may vary by model
        const suspicious = [
          "cell phone",
          "book",
          "laptop",
          "keyboard",
          "handbag",
          "remote",
        ];
        objects.forEach((obj) => {
          if (suspicious.includes(obj.class)) {
            // draw bbox
            const [x, y, w, h] = obj.bbox;
            ctx.strokeStyle = "orange";
            ctx.strokeRect(x, y, w, h);
            ctx.font = "14px Arial";
            ctx.fillStyle = "orange";
            ctx.fillText(
              `${obj.class} (${(obj.score * 100).toFixed(0)}%)`,
              x,
              y > 10 ? y - 6 : y + 14
            );
            addEvent(
              "suspicious_object",
              `${obj.class} detected (score ${(obj.score * 100).toFixed(0)}%)`
            );
          }
        });
      } catch (e) {
        console.error("detection error", e);
      }
    }, 350); // run ~3x/sec
  }

  function stopDetectionLoop() {
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
  }

  // media recorder handlers
  function startRecording() {
    const stream = videoRef.current.srcObject;
    if (!stream) return alert("Allow camera and microphone");
    recordedChunksRef.current = [];
    const options = { mimeType: "video/webm;codecs=vp9,opus" };
    const mr = new MediaRecorder(stream, options);
    mediaRecorderRef.current = mr;
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    mr.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
      // preview (optional)
      const url = URL.createObjectURL(blob);
      addEvent(
        "recording_stopped",
        `Recording stopped, size ${(blob.size / 1024 / 1024).toFixed(2)} MB`
      );
      // upload to backend
      try {
        const fd = new FormData();
        fd.append("candidateName", candidateName);
        fd.append(
          "video",
          blob,
          `${candidateName.replace(/\s+/g, "_")}_${Date.now()}.webm`
        );
        await fetch(`${backendUrl}/api/upload-video`, {
          method: "POST",
          body: fd,
        });
        addEvent("video_uploaded", "Recorded video uploaded to server");
      } catch (err) {
        console.warn("upload failed", err);
        addEvent("upload_error", "Video upload failed");
      }
    };
    mr.start();
    setRecording(true);
    addEvent("recording_started", "Recording started");
    // start detection loop when recording (or always)
    startDetectionLoop();
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    addEvent("stop_recording", "User stopped recording");
    // keep detection running if you want; you can stop it here if not needed
    stopDetectionLoop();
  }

  // report download helper (CSV)
  async function downloadCSV() {
    // fetch logs from server or use local events
    const csvRows = [
      ["timestamp", "type", "detail"],
      ...events.map((ev) => [ev.ts, ev.type, ev.detail]),
    ];
    const csv = csvRows
      .map((r) =>
        r.map((cell) => `"${(cell + "").replace(/"/g, '""')}"`).join(",")
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${candidateName.replace(/\s+/g, "_")}_proctoring_report.csv`;
    a.click();
  }

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-2">Interview: {candidateName}</h2>
      <div style={{ position: "relative", width: 640, maxWidth: "100%" }}>
        <video
          ref={videoRef}
          width="640"
          height="480"
          style={{ borderRadius: 8, background: "#000" }}
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            pointerEvents: "none",
          }}
        />
      </div>

      <div className="mt-3 space-x-2">
        {!recording ? (
          <button
            onClick={startRecording}
            className="px-4 py-2 rounded bg-green-600 text-white"
          >
            Start Recording
          </button>
        ) : (
          <button
            onClick={stopRecording}
            className="px-4 py-2 rounded bg-red-600 text-white"
          >
            Stop Recording
          </button>
        )}
        <button
          onClick={downloadCSV}
          className="px-4 py-2 rounded bg-slate-700 text-white"
        >
          Download CSV
        </button>
      </div>

      <div className="mt-4">
        <h3 className="font-medium">Events (latest first)</h3>
        <div
          style={{
            maxHeight: 220,
            overflow: "auto",
            background: "#0b1220",
            color: "#cbd5e1",
            padding: 8,
            borderRadius: 6,
          }}
        >
          {events
            .slice()
            .reverse()
            .map((ev, idx) => (
              <div
                key={idx}
                style={{
                  fontSize: 13,
                  padding: "6px 0",
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                }}
              >
                <div style={{ fontWeight: 600 }}>{ev.type}</div>
                <div style={{ fontSize: 12 }}>{ev.detail}</div>
                <div style={{ fontSize: 11, opacity: 0.7 }}>{ev.ts}</div>
              </div>
            ))}
        </div>
      </div>

      <div className="mt-2 text-sm text-gray-500">
        Models loaded: {modelsLoaded ? "✅" : "Loading..."}
      </div>
    </div>
  );
}
