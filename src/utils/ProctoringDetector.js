// frontend/src/utils/ProctoringDetector.js
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgl";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import * as faceLandmarksDetection from "@tensorflow-models/face-landmarks-detection";

export class ProctoringDetector {
  constructor(options = {}) {
    this.objectModel = null;
    this.faceDetector = null;
    this.modelsLoaded = false;
    this.detectionInterval = null;

    // Configuration
    this.config = {
      // Per-type detection intervals (object detection is faster)
      objectDetectionIntervalMs:
        options.objectDetectionIntervalMs || options.detectionIntervalMs || 200,
      faceDetectionIntervalMs:
        options.faceDetectionIntervalMs || options.detectionIntervalMs || 400,
      noFaceThresholdMs: options.noFaceThresholdMs || 10000,
      // default to a faster looking-away threshold (1s) for snappier reactions
      lookingAwayThresholdMs: options.lookingAwayThresholdMs || 1000,
      centerThreshold: options.centerThreshold || 0.25,
      suspiciousObjects: options.suspiciousObjects || [
        "cell phone",
        "book",
        "laptop",
        "keyboard",
        "mouse",
        "handbag",
        "backpack",
        "bottle",
        "cup",
        "remote",
      ],
      ...options,
    };

    // State tracking
    this.lastFaceSeenTs = Date.now();
    this.lastLookingCenterTs = Date.now();
    this.noFaceAlertSent = false;
    this.lookingAwayAlertSent = false;

    // Event callbacks
    this.onEvent = options.onEvent || (() => {});
    this.onModelLoaded = options.onModelLoaded || (() => {});
    // Optional frame-level callback (for debug / UI overlay). Receives { faces, objects, timestamp }
    this.onFrame = options.onFrame || (() => {});
    this._lastFaceCount = 0;
    this._lastObjectCount = 0;
    this._lastFaceSnapshot = [];
    this._lastObjectSnapshot = [];
    this._noFaceStreak = 0;
    this._triedFullModel = false;
    this._recreating = false;
    this._objectInterval = null;
    this._faceInterval = null;
    this._offscreenCanvas = null;
  }

  async initialize() {
    try {
      await tf.setBackend("webgl");
      await tf.ready();

      // Load models in parallel
      const [objModel, faceModel] = await Promise.all([
        cocoSsd.load(),
        faceLandmarksDetection.createDetector(
          faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
          {
            runtime: "tfjs",
            modelType: "short",
            maxFaces: 3,
          }
        ),
      ]);

      this.objectModel = objModel;
      this.faceDetector = faceModel;
      this.modelsLoaded = true;

      console.log("ProctoringDetector: models loaded", {
        objectModel: !!objModel,
        faceDetector: !!faceModel,
        tfBackend: tf.getBackend ? tf.getBackend() : null,
      });
      this.onModelLoaded();
      this.logEvent("models_loaded", "Detection models loaded successfully");

      return true;
    } catch (error) {
      console.error("Failed to initialize models:", error);
      this.logEvent("initialization_error", error.message);
      return false;
    }
  }

  startDetection(videoElement, canvasElement = null) {
    if (!this.modelsLoaded) {
      console.warn("Models not loaded yet");
      return;
    }

    // If detection already running, don't start again
    if (this._objectInterval || this._faceInterval) {
      console.debug(
        "ProctoringDetector: detection already running, skip start"
      );
      return;
    }

    // If video not ready, skip start (caller should retry)
    if (!videoElement || videoElement.readyState < 2) {
      console.debug("ProctoringDetector: video not ready, skip start");
      return;
    }

    // Start object detection interval (higher frequency)
    this._objectInterval = setInterval(async () => {
      try {
        // guard: if video has zero size (e.g., candidate left) skip detection
        if (
          !videoElement ||
          !videoElement.videoWidth ||
          !videoElement.videoHeight
        ) {
          // nothing to detect
          return;
        }
        const objects = await this.detectObjects(videoElement);
        this._lastObjectCount = objects ? objects.length : 0;
        this._lastObjectSnapshot = objects || [];

        // call onFrame to update UI overlay with latest objects and last faces snapshot
        try {
          this.onFrame({
            faces: this._lastFaceSnapshot || [],
            objects: this._lastObjectSnapshot || [],
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.warn("onFrame handler error (object tick)", e);
        }
      } catch (e) {
        console.error("Object detection tick error", e);
      }
    }, this.config.objectDetectionIntervalMs);

    // Start face detection interval (lower frequency)
    this._faceInterval = setInterval(async () => {
      try {
        if (
          !videoElement ||
          !videoElement.videoWidth ||
          !videoElement.videoHeight
        ) {
          return;
        }
        const faces = await this.detectFaces(
          videoElement,
          videoElement.videoWidth,
          videoElement.videoHeight,
          this._lastObjectSnapshot
        );
        this._lastFaceCount = faces ? faces.length : 0;
        this._lastFaceSnapshot = faces || [];

        // call onFrame to update UI overlay with latest faces and objects
        try {
          this.onFrame({
            faces: this._lastFaceSnapshot || [],
            objects: this._lastObjectSnapshot || [],
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.warn("onFrame handler error (face tick)", e);
        }
      } catch (e) {
        console.error("Face detection tick error", e);
      }
    }, this.config.faceDetectionIntervalMs);

    this.logEvent("detection_started", "Proctoring detection started");
  }

  stopDetection() {
    if (this._objectInterval) {
      clearInterval(this._objectInterval);
      this._objectInterval = null;
    }
    if (this._faceInterval) {
      clearInterval(this._faceInterval);
      this._faceInterval = null;
    }
    this.logEvent("detection_stopped", "Proctoring detection stopped");
  }

  async runDetection(videoElement, canvasElement) {
    if (!videoElement || videoElement.readyState < 2) return;

    // ensure video has valid pixel dimensions before running models
    if (!videoElement.videoWidth || !videoElement.videoHeight) return;

    try {
      const videoWidth = videoElement.videoWidth;
      const videoHeight = videoElement.videoHeight;

      // Run object detection first (we can use person bboxes to help face detection)
      const objects = await this.detectObjects(videoElement);

      // Run face detection (may use object bboxes as crop hints)
      const faces = await this.detectFaces(
        videoElement,
        videoWidth,
        videoHeight,
        objects
      );

      // store last counts for UI/debug
      this._lastFaceCount = faces ? faces.length : 0;
      this._lastObjectCount = objects ? objects.length : 0;

      // Adaptive fallback: if we're seeing objects (person) but no faces for several frames,
      // try switching the face detector to the more accurate 'full' model (slower).
      try {
        if (!faces || faces.length === 0) {
          this._noFaceStreak = (this._noFaceStreak || 0) + 1;
        } else {
          this._noFaceStreak = 0;
          // reset triedFullModel when detection succeeds again
          this._triedFullModel = false;
        }

        const seesPerson = (objects || []).some(
          (o) => o.class && o.class.toLowerCase().includes("person")
        );

        if (
          this._noFaceStreak >= 5 &&
          seesPerson &&
          !this._triedFullModel &&
          !this._recreating
        ) {
          // upgrade model to 'full'
          this._recreating = true;
          console.log(
            "ProctoringDetector: no faces detected despite person present — switching to 'full' face model for better accuracy"
          );
          try {
            const newFace = await faceLandmarksDetection.createDetector(
              faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
              { runtime: "tfjs", modelType: "full", maxFaces: 3 }
            );
            if (this.faceDetector && this.faceDetector.dispose)
              this.faceDetector.dispose();
            this.faceDetector = newFace;
            this._triedFullModel = true;
            console.log("ProctoringDetector: switched to full face model");
          } catch (e) {
            console.error(
              "ProctoringDetector: failed to switch to full model",
              e
            );
          } finally {
            this._recreating = false;
          }
        }
      } catch (e) {
        console.warn("Adaptive fallback error", e);
      }

      // Fire frame callback for live UI
      try {
        this.onFrame({
          faces: faces || [],
          objects: objects || [],
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        console.warn("onFrame handler error", e);
      }

      // detailed log (limit face data to small sample to avoid huge logs)
      console.log("ProctoringDetector: frame", {
        faces: this._lastFaceCount,
        objects: this._lastObjectCount,
        videoSize: { w: videoWidth, h: videoHeight },
        faceSample: (faces || []).slice(0, 2).map((f) => {
          const b = this.getFaceBox(f);
          return {
            box: b ? b.map((n) => Math.round(n)) : null,
            keypointsCount: f.keypoints ? f.keypoints.length : 0,
          };
        }),
      });

      // Draw visualizations if canvas provided
      if (canvasElement) {
        this.drawDetections(
          canvasElement,
          faces,
          objects,
          videoWidth,
          videoHeight
        );
      }
    } catch (error) {
      console.error("Detection error:", error);
    }
  }

  async detectFaces(videoElement, videoWidth, videoHeight, objects = []) {
    // Try full-frame detection first
    let faces = [];
    try {
      // skip if video size invalid
      if (!videoWidth || !videoHeight) {
        return [];
      }
      faces = await this.faceDetector.estimateFaces(videoElement);
    } catch (e) {
      console.warn("ProctoringDetector: full-frame face estimate failed", e);
      faces = [];
    }

    // If no faces found, but object detector sees person(s), try running
    // face detection on the person bounding boxes (crop & upscale). This
    // often helps when faces are small in the full frame or models miss them.
    const personObjects = (objects || []).filter(
      (o) => o.class && o.class.toLowerCase().includes("person")
    );

    if ((!faces || faces.length === 0) && personObjects.length > 0) {
      try {
        const cropResults = [];
        for (const obj of personObjects) {
          const personFaces = await this._detectFacesInBBox(
            videoElement,
            obj.bbox,
            videoWidth,
            videoHeight
          );
          if (personFaces && personFaces.length) {
            // merge personFaces into faces (they're mapped to full-frame coords)
            cropResults.push(...personFaces);
          }
        }

        if (cropResults.length > 0) {
          console.log(
            `ProctoringDetector: found ${cropResults.length} face(s) via person-crop fallback`
          );
          faces = cropResults;
        }
      } catch (e) {
        console.warn(
          "ProctoringDetector: person-crop face detection failed",
          e
        );
      }
    }
    const now = Date.now();

    if (!faces || faces.length === 0) {
      // No face detected
      const timeSinceLastFace = now - this.lastFaceSeenTs;

      if (
        timeSinceLastFace > this.config.noFaceThresholdMs &&
        !this.noFaceAlertSent
      ) {
        this.logEvent("no_face_detected", {
          duration: Math.round(timeSinceLastFace / 1000),
          severity: "high",
        });
        this.noFaceAlertSent = true;
      }
    } else {
      // Face(s) detected
      this.lastFaceSeenTs = now;
      this.noFaceAlertSent = false;

      // Check for multiple faces
      if (faces.length > 1) {
        this.logEvent("multiple_faces_detected", {
          count: faces.length,
          severity: "high",
        });
      }

      // Check face orientation for the primary face
      const primaryFace = faces[0];
      const faceCenterX = this.getFaceCenterX(primaryFace, videoWidth);
      const faceCenterY = this.getFaceCenterY(primaryFace, videoHeight);

      const isLookingCenter = this.isLookingAtCenter(
        faceCenterX,
        faceCenterY,
        videoWidth,
        videoHeight
      );

      if (isLookingCenter) {
        this.lastLookingCenterTs = now;
        this.lookingAwayAlertSent = false;
      } else {
        const timeLookingAway = now - this.lastLookingCenterTs;

        if (
          timeLookingAway > this.config.lookingAwayThresholdMs &&
          !this.lookingAwayAlertSent
        ) {
          this.logEvent("looking_away", {
            duration: Math.round(timeLookingAway / 1000),
            position: { x: faceCenterX, y: faceCenterY },
            severity: "medium",
          });
          this.lookingAwayAlertSent = true;
        }
      }
    }

    return faces;
  }

  // Run face detection on a region (bbox = [x,y,w,h] relative to video pixels).
  // Returns face objects with box/keypoints mapped to full-frame coordinates.
  async _detectFacesInBBox(videoElement, bbox, videoWidth, videoHeight) {
    try {
      if (!bbox || bbox.length < 4) return [];
      if (!videoWidth || !videoHeight) return [];
      const [bx, by, bw, bh] = bbox.map((n) => Math.round(n));

      // clamp region
      const x = Math.max(0, bx);
      const y = Math.max(0, by);
      const w = Math.max(8, Math.min(bw, videoWidth - x));
      const h = Math.max(8, Math.min(bh, videoHeight - y));

      // choose a target size to upscale small faces for better accuracy
      const targetShort = 256; // short side target
      const scale = Math.max(1, Math.ceil(targetShort / Math.min(w, h)));
      const targetW = Math.round(w * scale);
      const targetH = Math.round(h * scale);

      // reuse an offscreen canvas to avoid allocations
      if (!this._offscreenCanvas)
        this._offscreenCanvas = document.createElement("canvas");
      const off = this._offscreenCanvas;
      off.width = targetW;
      off.height = targetH;
      const ctx = off.getContext("2d");

      // draw the person region into the canvas (upscaled)
      ctx.drawImage(videoElement, x, y, w, h, 0, 0, targetW, targetH);

      // run face detector on the cropped canvas
      const cropFaces = await this.faceDetector.estimateFaces(off);
      if (!cropFaces || cropFaces.length === 0) return [];

      // map faces back to original video coordinates
      const mapped = cropFaces.map((f) => {
        const mappedFace = { ...f };

        // Normalize bbox formats: some models return array [x,y,w,h], others
        // return objects with topLeft/bottomRight arrays or xMin/xMax fields.
        let fx, fy, fw, fh;
        if (Array.isArray(f.box) && f.box.length >= 4) {
          [fx, fy, fw, fh] = f.box;
        } else if (f.box && f.box.topLeft && f.box.bottomRight) {
          const [tlx, tly] = f.box.topLeft;
          const [brx, bry] = f.box.bottomRight;
          fx = tlx;
          fy = tly;
          fw = brx - tlx;
          fh = bry - tly;
        } else if (
          f.boundingBox &&
          f.boundingBox.topLeft &&
          f.boundingBox.bottomRight
        ) {
          const [tlx, tly] = f.boundingBox.topLeft;
          const [brx, bry] = f.boundingBox.bottomRight;
          fx = tlx;
          fy = tly;
          fw = brx - tlx;
          fh = bry - tly;
        } else if (f.boundingBox && f.boundingBox.xMin !== undefined) {
          // some formats use xMin/xMax
          const xmin = f.boundingBox.xMin;
          const ymin = f.boundingBox.yMin || 0;
          const xmax = f.boundingBox.xMax || xmin;
          const ymax = f.boundingBox.yMax || ymin;
          fx = xmin;
          fy = ymin;
          fw = xmax - xmin;
          fh = ymax - ymin;
        }

        if (
          fx !== undefined &&
          fy !== undefined &&
          fw !== undefined &&
          fh !== undefined
        ) {
          const rx = x + (fx * w) / targetW;
          const ry = y + (fy * h) / targetH;
          const rw = (fw * w) / targetW;
          const rh = (fh * h) / targetH;
          mappedFace.box = [rx, ry, rw, rh];
        }

        if (f.keypoints && f.keypoints.length) {
          mappedFace.keypoints = f.keypoints.map((kp) => {
            if (kp && typeof kp === "object" && kp.x !== undefined) {
              return {
                x: x + (kp.x * w) / targetW,
                y: y + (kp.y * h) / targetH,
              };
            }
            // legacy array format [x,y] or [x,y,z]
            if (Array.isArray(kp) && kp.length >= 2) {
              return [x + (kp[0] * w) / targetW, y + (kp[1] * h) / targetH];
            }
            return kp;
          });
        }

        return mappedFace;
      });

      return mapped;
    } catch (e) {
      console.warn("ProctoringDetector: _detectFacesInBBox error", e);
      return [];
    }
  }

  // Expose a method to force switching to the full model (useful for manual tests)
  async forceFullModel() {
    if (!this.modelsLoaded) return false;
    if (this._recreating) return false;
    this._recreating = true;
    try {
      const newFace = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        { runtime: "tfjs", modelType: "full", maxFaces: 3 }
      );
      if (this.faceDetector && this.faceDetector.dispose)
        this.faceDetector.dispose();
      this.faceDetector = newFace;
      this._triedFullModel = true;
      console.log("ProctoringDetector: force-switched to full face model");
      return true;
    } catch (e) {
      console.error("ProctoringDetector: forceFullModel failed", e);
      return false;
    } finally {
      this._recreating = false;
    }
  }

  async detectObjects(videoElement) {
    const objects = await this.objectModel.detect(videoElement);

    // Filter and log suspicious objects
    const suspiciousDetected = objects.filter((obj) =>
      this.config.suspiciousObjects.some((suspicious) =>
        obj.class.toLowerCase().includes(suspicious.toLowerCase())
      )
    );

    suspiciousDetected.forEach((obj) => {
      this.logEvent("suspicious_object_detected", {
        object: obj.class,
        confidence: Math.round(obj.score * 100),
        severity: this.getObjectSeverity(obj.class),
      });
    });

    return objects;
  }

  // Normalize various face bounding-box formats to [x,y,width,height]
  getFaceBox(face) {
    if (!face) return null;
    const b = face.box || face.boundingBox || face;

    // Array format [x,y,w,h]
    if (Array.isArray(b) && b.length >= 4) {
      return [
        Number(b[0]) || 0,
        Number(b[1]) || 0,
        Number(b[2]) || 0,
        Number(b[3]) || 0,
      ];
    }

    // MediaPipe style: { topLeft: [x,y], bottomRight: [x,y] }
    if (b && b.topLeft && b.bottomRight) {
      const [tlx, tly] = b.topLeft;
      const [brx, bry] = b.bottomRight;
      return [tlx, tly, brx - tlx, bry - tly];
    }

    // Other boundingBox object with xMin/xMax
    if (b && b.xMin !== undefined) {
      const xmin = b.xMin;
      const ymin = b.yMin || 0;
      const xmax = b.xMax || xmin;
      const ymax = b.yMax || ymin;
      return [xmin, ymin, xmax - xmin, ymax - ymin];
    }

    // Object with x,y,width,height
    if (b && b.x !== undefined && b.width !== undefined) {
      return [b.x, b.y || 0, b.width, b.height || 0];
    }

    return null;
  }

  getFaceCenterX(face, videoWidth) {
    const box = this.getFaceBox(face);
    if (box) {
      const [x, , width] = box;
      return (x + width / 2) / videoWidth;
    }

    if (face.keypoints && face.keypoints.length > 0) {
      const avgX =
        face.keypoints.reduce((sum, kp) => sum + (kp.x || kp[0]), 0) /
        face.keypoints.length;
      return avgX / videoWidth;
    }

    return 0.5;
  }

  getFaceCenterY(face, videoHeight) {
    const box = this.getFaceBox(face);
    if (box) {
      const [, y, , height] = box;
      return (y + height / 2) / videoHeight;
    }

    if (face.keypoints && face.keypoints.length > 0) {
      const avgY =
        face.keypoints.reduce((sum, kp) => sum + (kp.y || kp[1]), 0) /
        face.keypoints.length;
      return avgY / videoHeight;
    }

    return 0.5;
  }

  isLookingAtCenter(faceCenterX, faceCenterY, videoWidth, videoHeight) {
    const deltaX = Math.abs(faceCenterX - 0.5);
    const deltaY = Math.abs(faceCenterY - 0.5);

    return (
      deltaX < this.config.centerThreshold &&
      deltaY < this.config.centerThreshold
    );
  }

  getObjectSeverity(objectClass) {
    const highSeverity = ["cell phone", "laptop", "keyboard", "mouse"];
    const mediumSeverity = ["book", "notebook", "paper"];

    const lowerClass = objectClass.toLowerCase();

    if (highSeverity.some((item) => lowerClass.includes(item))) {
      return "high";
    } else if (mediumSeverity.some((item) => lowerClass.includes(item))) {
      return "medium";
    }

    return "low";
  }

  drawDetections(canvas, faces, objects, videoWidth, videoHeight) {
    const ctx = canvas.getContext("2d");

    canvas.width = videoWidth;
    canvas.height = videoHeight;
    ctx.clearRect(0, 0, videoWidth, videoHeight);

    // Draw face detections
    ctx.strokeStyle = faces.length === 1 ? "#00ff00" : "#ff0000";
    ctx.lineWidth = 2;

    faces.forEach((face) => {
      if (face.box) {
        const [x, y, width, height] = face.box;
        ctx.strokeRect(x, y, width, height);
      }
    });

    // Draw object detections
    objects.forEach((obj) => {
      const isSuspicious = this.config.suspiciousObjects.some((suspicious) =>
        obj.class.toLowerCase().includes(suspicious.toLowerCase())
      );

      if (isSuspicious) {
        const [x, y, width, height] = obj.bbox;

        ctx.strokeStyle = "#ffa500";
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, width, height);

        // Draw label
        ctx.fillStyle = "#ffa500";
        ctx.font = "16px Arial";
        ctx.fillText(
          `${obj.class} (${Math.round(obj.score * 100)}%)`,
          x,
          y > 20 ? y - 5 : y + 20
        );
      }
    });
  }

  logEvent(type, details) {
    const event = {
      type,
      details,
      timestamp: new Date().toISOString(),
    };

    this.onEvent(event);
  }

  getStats() {
    return {
      modelsLoaded: this.modelsLoaded,
      isDetecting: !!this.detectionInterval,
      lastFaceCount: this._lastFaceCount || 0,
      lastObjectCount: this._lastObjectCount || 0,
    };
  }

  destroy() {
    this.stopDetection();

    if (this.objectModel) {
      this.objectModel.dispose();
    }

    if (this.faceDetector) {
      this.faceDetector.dispose();
    }

    this.modelsLoaded = false;
  }
}
