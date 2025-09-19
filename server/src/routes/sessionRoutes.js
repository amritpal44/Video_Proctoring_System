import express from "express";
import { createSession, getSession } from "../controllers/sessionController.js";
import { updateSessionTitle } from "../controllers/sessionController.js";
import { authMiddleware, requireAuth } from "../middleware/authMiddleware.js";
import { closeSession } from "../controllers/sessionController.js";
import { requireRole } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(authMiddleware);
router.post("/create", requireRole("interviewer"), createSession);
router.get("/:sessionId", getSession);
router.post("/:sessionId/close", requireRole("interviewer"), closeSession);
router.post(
  "/:sessionId/title",
  requireRole("interviewer"),
  updateSessionTitle
);

export default router;
