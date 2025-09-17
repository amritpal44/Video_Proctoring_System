import { generateSessionId } from "../utils/generateId.js";
import { sessions } from "../socket.js";

// REST endpoint to create session (by interviewer)
export function createSession(req, res) {
  const { interviewerName } = req.body;
  if (!interviewerName) {
    return res.status(400).json({ error: "interviewerName is required" });
  }

  const sessionId = generateSessionId();
  sessions[sessionId] = {
    sessionId,
    interviewer: { name: interviewerName, socketId: null },
    candidate: null,
  };

  return res.json({ sessionId });
}
