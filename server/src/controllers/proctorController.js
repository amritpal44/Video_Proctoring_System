// server/src/controllers/proctorController.js
import ProctorEvent from "../models/ProctorEvent.js";
import Interview from "../models/Interview.js";

export async function createEvent(req, res) {
  try {
    const {
      sessionId,
      interviewId,
      type,
      details,
      severity = 1,
      timestamp,
    } = req.body;

    if (!type) return res.status(400).json({ error: "missing_type" });

    // Find or create interview if sessionId provided
    let interview = null;
    if (interviewId) {
      interview = await Interview.findById(interviewId);
    } else if (sessionId) {
      interview = await Interview.findOne({ sessionId });
    }

    // Convert string severity to number if needed
    let sev = severity;
    if (typeof sev === "string") {
      sev = severityStringToNumber(sev);
    }
    if (typeof sev !== "number" || isNaN(sev)) {
      sev = calculateSeverity(type);
    }

    const event = await ProctorEvent.create({
      interview: interview?._id,
      user: req.user ? req.user.id : null,
      type,
      details,
      severity: sev,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    return res.json({ event });
  } catch (err) {
    console.error("createEvent error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function createEventsBatch(req, res) {
  try {
    const { events } = req.body;

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({ error: "invalid_events_array" });
    }

    const createdEvents = [];

    for (const eventData of events) {
      const { sessionId, interviewId, event } = eventData;

      let interview = null;
      if (interviewId) {
        interview = await Interview.findById(interviewId);
      } else if (sessionId) {
        interview = await Interview.findOne({ sessionId });
      }

      if (interview) {
        // Convert string severity to number if needed
        let sev = event.details?.severity ?? event.severity;
        if (typeof sev === "string") {
          sev = severityStringToNumber(sev);
        }
        if (typeof sev !== "number" || isNaN(sev)) {
          sev = calculateSeverity(event.type);
        }

        const proctorEvent = await ProctorEvent.create({
          interview: interview._id,
          user: req.user ? req.user.id : null,
          type: event.type,
          details: event.details,
          severity: sev,
          timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
        });
        createdEvents.push(proctorEvent);
      }
    }

    return res.json({ events: createdEvents, count: createdEvents.length });
  } catch (err) {
    console.error("createEventsBatch error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function listEvents(req, res) {
  try {
    const { interviewId, sessionId, from, to, type, severity } = req.query;
    const q = {};

    // Find interview by ID or sessionId
    if (interviewId) {
      q.interview = interviewId;
    } else if (sessionId) {
      const interview = await Interview.findOne({ sessionId });
      if (interview) {
        q.interview = interview._id;
      }
    }

    if (from || to) q.timestamp = {};
    if (from) q.timestamp.$gte = new Date(from);
    if (to) q.timestamp.$lte = new Date(to);
    if (type) q.type = type;
    if (severity) q.severity = { $gte: parseInt(severity) };

    const events = await ProctorEvent.find(q)
      .sort({ timestamp: -1 })
      .limit(500)
      .populate("user", "name email");

    return res.json({ events });
  } catch (err) {
    console.error("listEvents error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function getIntegrityScore(req, res) {
  try {
    const { interviewId } = req.params;

    if (!interviewId) {
      return res.status(400).json({ error: "missing_interview_id" });
    }

    // Get all events for this interview
    const events = await ProctorEvent.find({ interview: interviewId });

    // Calculate score based on events
    let score = 100;
    const deductions = {
      no_face_detected: 5,
      multiple_faces_detected: 10,
      suspicious_object_detected: 3,
      looking_away: 2,
    };

    // Count events by type
    const eventCounts = {};
    events.forEach((event) => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    });

    // Apply deductions
    Object.entries(deductions).forEach(([eventType, deduction]) => {
      if (eventCounts[eventType]) {
        score -= eventCounts[eventType] * deduction;
      }
    });

    // Ensure score doesn't go below 0
    score = Math.max(0, score);

    return res.json({
      score,
      eventCounts,
      totalEvents: events.length,
    });
  } catch (err) {
    console.error("getIntegrityScore error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function listInterviews(req, res) {
  try {
    const { q, from, to, candidateEmail, interviewerEmail } = req.query;
    const filter = {};

    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { sessionId: new RegExp(q, "i") },
      ];
    }

    if (from || to) filter.startTime = {};
    if (from) filter.startTime.$gte = new Date(from);
    if (to) filter.startTime.$lte = new Date(to);

    // Pre-filter by email if provided
    let candidateIds = null;
    let interviewerIds = null;

    if (candidateEmail) {
      const User = (await import("../models/User.js")).default;
      const candidates = await User.find({
        email: new RegExp(candidateEmail, "i"),
        role: "candidate",
      }).select("_id");
      candidateIds = candidates.map((c) => c._id);
      filter.candidate = { $in: candidateIds };
    }

    if (interviewerEmail) {
      const User = (await import("../models/User.js")).default;
      const interviewers = await User.find({
        email: new RegExp(interviewerEmail, "i"),
        role: { $in: ["interviewer", "admin"] },
      }).select("_id");
      interviewerIds = interviewers.map((i) => i._id);
      filter.interviewer = { $in: interviewerIds };
    }

    const interviews = await Interview.find(filter)
      .populate("candidate interviewer", "name email")
      .sort({ startTime: -1 })
      .limit(200);

    // Add integrity scores to each interview
    const interviewsWithScores = await Promise.all(
      interviews.map(async (interview) => {
        const events = await ProctorEvent.find({ interview: interview._id });

        let score = 100;
        const deductions = {
          no_face_detected: 5,
          multiple_faces_detected: 10,
          suspicious_object_detected: 3,
          looking_away: 2,
        };

        const eventCounts = {};
        events.forEach((event) => {
          eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
        });

        Object.entries(deductions).forEach(([eventType, deduction]) => {
          if (eventCounts[eventType]) {
            score -= eventCounts[eventType] * deduction;
          }
        });

        score = Math.max(0, score);

        return {
          ...interview.toObject(),
          integrityScore: score,
          proctorEventCount: events.length,
        };
      })
    );

    return res.json({ interviews: interviewsWithScores });
  } catch (err) {
    console.error("listInterviews error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function generateReport(req, res) {
  try {
    const { interviewId } = req.params;

    const interview = await Interview.findById(interviewId).populate(
      "candidate interviewer",
      "name email"
    );

    if (!interview) {
      return res.status(404).json({ error: "interview_not_found" });
    }

    const events = await ProctorEvent.find({ interview: interviewId }).sort({
      timestamp: 1,
    });

    // Calculate integrity score
    let score = 100;
    const deductions = {
      no_face_detected: 5,
      multiple_faces_detected: 10,
      suspicious_object_detected: 3,
      looking_away: 2,
    };

    const eventCounts = {};
    const eventTimeline = [];

    events.forEach((event) => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;

      // Skip non-critical events in timeline
      if (
        !["models_loaded", "detection_started", "detection_stopped"].includes(
          event.type
        )
      ) {
        eventTimeline.push({
          timestamp: event.timestamp,
          type: event.type,
          details: event.details,
          severity: event.severity,
        });
      }
    });

    Object.entries(deductions).forEach(([eventType, deduction]) => {
      if (eventCounts[eventType]) {
        score -= eventCounts[eventType] * deduction;
      }
    });

    score = Math.max(0, score);

    // Calculate duration
    const startTime = interview.startTime || interview.createdAt;
    const endTime = interview.endTime || new Date();
    const durationMs = endTime - startTime;
    const durationMinutes = Math.floor(durationMs / 60000);

    const report = {
      interview: {
        id: interview._id,
        sessionId: interview.sessionId,
        title: interview.title,
        startTime,
        endTime: interview.endTime,
        duration: `${durationMinutes} minutes`,
      },
      candidate: interview.candidate
        ? {
            name: interview.candidate.name,
            email: interview.candidate.email,
          }
        : null,
      interviewer: interview.interviewer
        ? {
            name: interview.interviewer.name,
            email: interview.interviewer.email,
          }
        : null,
      integrityScore: score,
      eventSummary: {
        total: events.length,
        noFaceDetected: eventCounts.no_face_detected || 0,
        lookingAway: eventCounts.looking_away || 0,
        multipleFaces: eventCounts.multiple_faces_detected || 0,
        suspiciousObjects: eventCounts.suspicious_object_detected || 0,
      },
      eventTimeline,
      generatedAt: new Date(),
    };

    return res.json({ report });
  } catch (err) {
    console.error("generateReport error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

// Helper function to calculate severity
function calculateSeverity(eventType) {
  const severityMap = {
    no_face_detected: 3,
    multiple_faces_detected: 3,
    suspicious_object_detected: 2,
    looking_away: 2,
    models_loaded: 0,
    detection_started: 0,
    detection_stopped: 0,
  };
  return severityMap[eventType] || 1;
}

// Helper to convert string severity to number
function severityStringToNumber(sev) {
  if (!sev) return 1;
  const map = { high: 3, medium: 2, low: 1 };
  return map[String(sev).toLowerCase()] ?? 1;
}
