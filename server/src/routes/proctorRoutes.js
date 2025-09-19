// server/src/routes/proctorRoutes.js
import express from "express";
import {
  createEvent,
  createEventsBatch,
  listEvents,
  listInterviews,
  getIntegrityScore,
  generateReport,
} from "../controllers/proctorController.js";
import {
  authMiddleware,
  requireAuth,
  requireRole,
} from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

// Events endpoints
router.post("/events", createEvent); // Allow both authenticated and unauthenticated for now
router.post("/events/batch", createEventsBatch); // Batch endpoint for performance
router.get("/events", requireAuth, listEvents);

// Integrity score
router.get("/score/:interviewId", requireAuth, getIntegrityScore);

// Interviews and reporting
router.get("/interviews", requireRole("interviewer"), listInterviews);
router.get("/report/:interviewId", requireRole("interviewer"), generateReport);

export default router;
