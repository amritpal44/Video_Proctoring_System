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
    let { q, from, to, candidateEmail, interviewerEmail, minScore } = req.query;
    const filter = {};

    // Default date range: past 1 week to now
    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Parse date-only inputs as full-day UTC ranges to be intuitive for users.
    // from -> YYYY-MM-DD => YYYY-MM-DDT00:00:00.000Z
    // to   -> YYYY-MM-DD => YYYY-MM-DDT23:59:59.999Z
    let fromDate;
    let toDate;
    try {
      if (from) {
        const maybe = new Date(`${String(from).trim()}T00:00:00.000Z`);
        fromDate = isNaN(maybe) ? oneWeekAgo : maybe;
      } else {
        fromDate = oneWeekAgo;
      }

      if (to) {
        const maybe2 = new Date(`${String(to).trim()}T23:59:59.999Z`);
        toDate = isNaN(maybe2) ? now : maybe2;
      } else {
        toDate = now;
      }
    } catch (e) {
      fromDate = oneWeekAgo;
      toDate = now;
    }

    // Match interviews where either startTime (if present) or createdAt falls within range
    filter.$or = [
      { startTime: { $gte: fromDate, $lte: toDate } },
      { createdAt: { $gte: fromDate, $lte: toDate } },
    ];

    // Pre-filter by email if provided (keeps DB-side filtering)
    if (candidateEmail) {
      const User = (await import("../models/User.js")).default;
      const candidates = await User.find({
        email: new RegExp(candidateEmail, "i"),
        role: "candidate",
      }).select("_id");
      const candidateIds = candidates.map((c) => c._id);
      if (candidateIds.length) filter.candidate = { $in: candidateIds };
    }

    if (interviewerEmail) {
      const User = (await import("../models/User.js")).default;
      const interviewers = await User.find({
        email: new RegExp(interviewerEmail, "i"),
        role: { $in: ["interviewer", "admin"] },
      }).select("_id");
      const interviewerIds = interviewers.map((i) => i._id);
      if (interviewerIds.length) filter.interviewer = { $in: interviewerIds };
    }

    // Fetch interviews matching coarse filters
    const interviews = await Interview.find(filter)
      .populate("candidate interviewer", "name email")
      .sort({ startTime: -1 })
      .limit(200);

    // Compute integrity score for each interview
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

    // Apply q search across multiple fields (title, sessionId, candidate/interviewer name/email)
    let filtered = interviewsWithScores;
    if (q && String(q).trim()) {
      const rx = new RegExp(String(q).trim(), "i");
      filtered = filtered.filter((iv) => {
        if (rx.test(iv.title || "")) return true;
        if (rx.test(iv.sessionId || "")) return true;
        if (
          iv.candidate &&
          (rx.test(iv.candidate.name || "") ||
            rx.test(iv.candidate.email || ""))
        )
          return true;
        if (
          iv.interviewer &&
          (rx.test(iv.interviewer.name || "") ||
            rx.test(iv.interviewer.email || ""))
        )
          return true;
        return false;
      });
    }

    // Filter by minScore (default 75)
    const min = parseInt(minScore ?? 75, 10);
    filtered = filtered.filter((iv) =>
      typeof iv.integrityScore === "number" ? iv.integrityScore >= min : true
    );

    return res.json({ interviews: filtered });
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

    // Helper to format a date into India time (IST)
    function formatToIST(d) {
      if (!d) return null;
      try {
        const date = new Date(d);
        // e.g. "19 Sep 2025, 20:34:12 IST" using toLocaleString with Asia/Kolkata
        const opts = {
          timeZone: "Asia/Kolkata",
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        };
        const human = date.toLocaleString("en-IN", opts);
        // produce an ISO-like string adjusted to IST by deriving parts
        return human + " IST";
      } catch (e) {
        return new Date(d).toString();
      }
    }

    const report = {
      interview: {
        id: interview._id,
        sessionId: interview.sessionId,
        title: interview.title,
        startTime: formatToIST(startTime),
        endTime: formatToIST(endTime),
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
      // convert timeline timestamps to IST strings
      eventTimeline: eventTimeline.map((e) => ({
        ...e,
        timestamp: formatToIST(e.timestamp),
      })),
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
