// server/src/controllers/sessionController.js
import { sessions } from "../socket.js";
import { generateSimpleId } from "../utils/generateId.js";

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

  return res.json({ sessionId });
}
