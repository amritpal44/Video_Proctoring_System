// frontend/src/components/ProctoringMonitor.jsx
import React, { useEffect, useRef, useState } from "react";
import { ProctoringDetector } from "../utils/ProctoringDetector";
import proctoringService from "../services/proctoringService";

export default function ProctoringMonitor({
  videoRef,
  sessionId,
  sessionState,
  enabled = true,
}) {
  const canvasRef = useRef(null);
  const detectorRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [stats, setStats] = useState({
    totalEvents: 0,
    noFaceCount: 0,
    lookingAwayCount: 0,
    multipleFacesCount: 0,
    suspiciousObjectsCount: 0,
    integrityScore: 100,
  });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    async function initializeDetector() {
      if (detectorRef.current) {
        console.log(
          "ProctoringMonitor: detector already initialized, skipping"
        );
        return;
      }
      try {
        if (!videoRef?.current) {
          setError(
            "Video element not available. Please check your camera stream."
          );
          return;
        }
        const detector = new ProctoringDetector({
          onEvent: handleProctoringEvent,
          onModelLoaded: () => {
            if (mounted) {
              setIsLoading(false);
              setError(null);
              console.log("Proctoring models loaded");
            }
          },
          onFrame: ({ faces, objects, timestamp }) => {
            // update a tiny live overlay
            setLiveInfo({
              faceCount: faces.length,
              objectCount: objects.length,
              ts: timestamp,
            });

            // draw object bboxes on the canvas for diagnostics
            try {
              const canvas = canvasRef.current;
              const video = videoRef.current;
              if (!canvas || !video) return;
              const ctx = canvas.getContext("2d");
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // draw object bboxes
              (objects || []).forEach((obj) => {
                const bbox = obj.bbox || obj.boundingBox || null;
                if (!bbox) return;
                let x, y, w, h;
                if (Array.isArray(bbox) && bbox.length >= 4) {
                  [x, y, w, h] = bbox;
                } else if (bbox.topLeft && bbox.bottomRight) {
                  const [tlx, tly] = bbox.topLeft;
                  const [brx, bry] = bbox.bottomRight;
                  x = tlx;
                  y = tly;
                  w = brx - tlx;
                  h = bry - tly;
                }

                if (x === undefined) return;

                const isPerson =
                  obj.class && obj.class.toLowerCase().includes("person");
                ctx.strokeStyle = isPerson ? "#00ff00" : "#ffa500";
                ctx.lineWidth = isPerson ? 2 : 3;
                ctx.strokeRect(x, y, w, h);
                ctx.fillStyle = ctx.strokeStyle;
                ctx.font = "14px Arial";
                ctx.fillText(
                  `${obj.class} ${(obj.score * 100).toFixed(0)}%`,
                  x,
                  y > 14 ? y - 6 : y + 14
                );
              });
            } catch (e) {
              // don't let drawing errors break detection
              console.warn("ProctoringMonitor draw error", e);
            }
          },
          detectionIntervalMs: 500,
          noFaceThresholdMs: 10000,
          lookingAwayThresholdMs: 5000,
        });

        detectorRef.current = detector;

        const initialized = await detector.initialize();
        if (!initialized) {
          setError("Failed to initialize proctoring detector");
          console.error("Failed to initialize proctoring detector");
          return;
        }

        // Start detection when video is ready
        // only start detection if modelsLoaded is true and video stream present
        if (
          detector.modelsLoaded &&
          videoRef?.current &&
          videoRef.current.srcObject
        ) {
          detector.startDetection(videoRef.current, canvasRef.current);
        } else if (!videoRef?.current || !videoRef.current.srcObject) {
          setError("No video stream found. Please start the camera.");
        }
      } catch (e) {
        setError("Error initializing proctoring: " + e.message);
        console.error(e);
      }
    }

    initializeDetector();

    return () => {
      mounted = false;
      if (detectorRef.current) {
        detectorRef.current.destroy();
      }
      proctoringService.destroy();
    };
  }, [enabled, videoRef?.current]);

  // Start/stop detection based on video stream availability
  useEffect(() => {
    if (!detectorRef.current || !videoRef?.current) return;

    const video = videoRef.current;

    // Check if video has a stream
    if (video.srcObject && video.srcObject.getTracks().length > 0) {
      // Wait for video to be ready
      const checkVideoReady = () => {
        if (video.readyState >= 2) {
          // ensure models are loaded before starting
          if (detectorRef.current.modelsLoaded) {
            detectorRef.current.startDetection(video, canvasRef.current);
          } else {
            console.debug(
              "Waiting for models to load before starting detection"
            );
            setTimeout(checkVideoReady, 200);
          }
        } else {
          setTimeout(checkVideoReady, 100);
        }
      };
      checkVideoReady();
    } else {
      detectorRef.current.stopDetection();
    }
  }, [videoRef?.current?.srcObject]);

  const [liveInfo, setLiveInfo] = useState({
    faceCount: 0,
    objectCount: 0,
    ts: null,
  });

  function handleProctoringEvent(event) {
    console.log("[ProctoringMonitor] Event:", event); // Debug log
    // Update local state
    setEvents((prev) => {
      const updated = [event, ...prev].slice(0, 100); // Keep last 100 events
      return updated;
    });

    // Update statistics
    updateStats(event);

    // Send to backend if we have session info
    if (sessionState?.interviewId) {
      proctoringService.queueEvent(sessionId, sessionState.interviewId, event);
    }

    // Log important events
    if (
      [
        "no_face_detected",
        "multiple_faces_detected",
        "suspicious_object_detected",
      ].includes(event.type)
    ) {
      console.warn(`⚠️ Proctoring Alert: ${event.type}`, event.details);
    }
  }

  function updateStats(event) {
    setStats((prev) => {
      const updated = { ...prev };
      updated.totalEvents++;

      switch (event.type) {
        case "no_face_detected":
          updated.noFaceCount++;
          updated.integrityScore = Math.max(0, updated.integrityScore - 5);
          break;
        case "looking_away":
          updated.lookingAwayCount++;
          updated.integrityScore = Math.max(0, updated.integrityScore - 2);
          break;
        case "multiple_faces_detected":
          updated.multipleFacesCount++;
          updated.integrityScore = Math.max(0, updated.integrityScore - 10);
          break;
        case "suspicious_object_detected":
          updated.suspiciousObjectsCount++;
          updated.integrityScore = Math.max(0, updated.integrityScore - 3);
          break;
      }

      return updated;
    });
  }

  function getEventColor(eventType) {
    const colorMap = {
      no_face_detected: "text-red-500",
      multiple_faces_detected: "text-red-500",
      suspicious_object_detected: "text-orange-500",
      looking_away: "text-yellow-500",
      models_loaded: "text-green-500",
      detection_started: "text-blue-500",
      detection_stopped: "text-gray-500",
    };
    return colorMap[eventType] || "text-gray-400";
  }

  function getScoreColor(score) {
    if (score >= 80) return "text-green-500";
    if (score >= 60) return "text-yellow-500";
    if (score >= 40) return "text-orange-500";
    return "text-red-500";
  }

  return (
    <div className="relative">
      {/* Overlay Canvas for Detection Visualization */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none z-10"
        style={{ maxHeight: "60vh" }}
      />

      {/* Proctoring Status Panel */}
      <div className="absolute top-4 right-4 bg-gray-900/90 backdrop-blur rounded-lg p-4 max-w-xs z-20">
        <h4 className="text-sm font-semibold text-white mb-2">
          Proctoring Monitor
        </h4>

        {error && <div className="text-xs text-red-400 mb-2">{error}</div>}

        {isLoading && !error ? (
          <div className="text-xs text-gray-400">Loading models...</div>
        ) : !error ? (
          <>
            {/* Integrity Score */}
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1">Integrity Score</div>
              <div
                className={`text-2xl font-bold ${getScoreColor(
                  stats.integrityScore
                )}`}
              >
                {stats.integrityScore}%
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div>
                <span className="text-gray-400">No Face:</span>
                <span className="ml-1 text-white font-semibold">
                  {stats.noFaceCount}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Looking Away:</span>
                <span className="ml-1 text-white font-semibold">
                  {stats.lookingAwayCount}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Multiple Faces:</span>
                <span className="ml-1 text-white font-semibold">
                  {stats.multipleFacesCount}
                </span>
              </div>
              <div>
                <span className="text-gray-400">Suspicious:</span>
                <span className="ml-1 text-white font-semibold">
                  {stats.suspiciousObjectsCount}
                </span>
              </div>
            </div>

            {/* Recent Events */}
            <div className="border-t border-gray-700 pt-2">
              <div className="text-xs text-gray-400 mb-1">Recent Events</div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {events.slice(0, 5).map((event, idx) => (
                  <div key={idx} className="text-xs">
                    <span className={getEventColor(event.type)}>
                      {event.type.replace(/_/g, " ")}
                    </span>
                    {event.details?.object && (
                      <span className="text-gray-400 ml-1">
                        ({event.details.object})
                      </span>
                    )}
                  </div>
                ))}
                {events.length === 0 && (
                  <div className="text-xs text-gray-500">No events yet</div>
                )}
              </div>
              {/* Force model button */}
              <div className="mt-2">
                <button
                  onClick={async () => {
                    if (!detectorRef.current) return;
                    try {
                      const ok = await detectorRef.current.forceFullModel();
                      if (ok) {
                        console.log("ProctoringMonitor: forced full model");
                      } else {
                        console.warn(
                          "ProctoringMonitor: forceFullModel returned false"
                        );
                      }
                    } catch (e) {
                      console.error("Force full model error", e);
                    }
                  }}
                  className="mt-1 px-2 py-1 rounded bg-slate-700 text-white text-xs"
                >
                  Force full model
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {/* Live overlay summary (small) */}
      <div className="absolute bottom-4 right-4 bg-gray-800/80 text-xs text-gray-200 rounded px-3 py-2 z-20">
        <div>
          Faces: <span className="font-semibold">{liveInfo.faceCount}</span>
        </div>
        <div>
          Objects: <span className="font-semibold">{liveInfo.objectCount}</span>
        </div>
        <div className="text-xs text-gray-400">
          {liveInfo.ts ? new Date(liveInfo.ts).toLocaleTimeString() : "—"}
        </div>
      </div>

      {/* Diagnostic: draw person bounding boxes on canvas (if detector supplied them via onFrame later) */}

      {/* Alert Badge for Critical Events */}
      {stats.integrityScore < 50 && (
        <div className="absolute top-4 left-4 bg-red-600/90 text-white px-3 py-1 rounded-full text-xs font-semibold animate-pulse z-20">
          ⚠️ Low Integrity Score
        </div>
      )}
    </div>
  );
}
