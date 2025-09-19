// server/src/controllers/sessionController.js
import { sessions } from "../socket.js";
import { generateSimpleId } from "../utils/generateId.js";
import Interview from "../models/Interview.js";

// create a session and ensure uniqueness
export function createSession(req, res) {
  const { interviewerName } = req.body;
  if (!interviewerName)
    return res.status(400).json({ error: "interviewerName required" });

  // generate unique id (regenerate if collision)
  let sessionId;
  do {
    sessionId = generateSimpleId(12);
  } while (sessions[sessionId]);

  sessions[sessionId] = {
    sessionId,
    interviewer: { name: interviewerName, socketId: null },
    candidate: null,
  };

  // create interview document and link
  try {
    const doc = new Interview({
      sessionId,
      title: `Interview ${sessionId}`,
      interviewer: req.user ? req.user.id : undefined,
    });
    doc
      .save()
      .then((d) => {
        sessions[sessionId].interviewId = d._id.toString();
      })
      .catch((e) => {
        console.warn("failed to create interview doc", e.message);
      });
  } catch (e) {
    console.warn("create interview error", e.message);
  }

  return res.json({ sessionId });
}

export async function closeSession(req, res) {
  try {
    const { sessionId } = req.params;
    const s = sessions[sessionId];
    if (!s) return res.status(404).json({ error: "session_not_found" });

    // only allow if caller is interviewer for this session or admin
    const callerId = req.user ? req.user.id : null;
    const callerRole = req.user ? req.user.role : null;
    if (callerRole !== "admin") {
      // require the caller to match the interviewer userId if available
      if (
        !s.interviewer ||
        !s.interviewer.userId ||
        s.interviewer.userId !== callerId
      ) {
        return res.status(403).json({ error: "forbidden" });
      }
    }

    // set interview endTime in DB if interviewId available
    if (s.interviewId) {
      await Interview.findByIdAndUpdate(s.interviewId, { endTime: new Date() });
    }

    // remove session from memory
    delete sessions[sessionId];
    return res.json({ ok: true });
  } catch (err) {
    console.error("closeSession error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export function getSession(req, res) {
  const { sessionId } = req.params;
  const s = sessions[sessionId];
  if (!s) return res.status(404).json({ error: "session_not_found" });
  // return minimal safe info
  return res.json({
    sessionId: s.sessionId,
    interviewId: s.interviewId || null,
    interviewer: s.interviewer ? { name: s.interviewer.name } : null,
  });
}

// update interview title both in-memory and in Interview document
export async function updateSessionTitle(req, res) {
  try {
    const { sessionId } = req.params;
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: "missing_title" });

    const s = sessions[sessionId];
    if (!s) return res.status(404).json({ error: "session_not_found" });

    // update in-memory session
    s.interviewTitle = title;

    // if interview doc exists, update it
    if (s.interviewId) {
      await Interview.findByIdAndUpdate(
        s.interviewId,
        { title },
        { new: true }
      );
    }

    return res.json({ ok: true, title });
  } catch (err) {
    console.error("updateSessionTitle error", err);
    return res.status(500).json({ error: "server_error" });
  }
}
