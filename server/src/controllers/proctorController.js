import ProctorEvent from "../models/ProctorEvent.js";
import Interview from "../models/Interview.js";

export async function createEvent(req, res) {
  try {
    const { interviewId, type, details, severity = 1 } = req.body;
    if (!type) return res.status(400).json({ error: "missing_type" });
    const event = await ProctorEvent.create({
      interview: interviewId,
      user: req.user ? req.user.id : null,
      type,
      details,
      severity,
    });
    return res.json({ event });
  } catch (err) {
    console.error("createEvent error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function listEvents(req, res) {
  try {
    const { interviewId, from, to } = req.query;
    const q = {};
    if (interviewId) q.interview = interviewId;
    if (from || to) q.timestamp = {};
    if (from) q.timestamp.$gte = new Date(from);
    if (to) q.timestamp.$lte = new Date(to);
    const events = await ProctorEvent.find(q)
      .sort({ timestamp: -1 })
      .limit(100)
      .populate("user", "name email");
    return res.json({ events });
  } catch (err) {
    console.error("listEvents error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function listInterviews(req, res) {
  try {
    const { q, from, to } = req.query;
    const filter = {};
    if (q) filter.title = new RegExp(q, "i");
    if (from || to) filter.startTime = {};
    if (from) filter.startTime.$gte = new Date(from);
    if (to) filter.startTime.$lte = new Date(to);
    const interviews = await Interview.find(filter)
      .populate("candidate interviewer", "name email")
      .sort({ startTime: -1 })
      .limit(200);
    return res.json({ interviews });
  } catch (err) {
    console.error("listInterviews error", err);
    return res.status(500).json({ error: "server_error" });
  }
}
