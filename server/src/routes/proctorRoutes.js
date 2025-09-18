import express from "express";
import {
  createEvent,
  listEvents,
  listInterviews,
} from "../controllers/proctorController.js";
import {
  authMiddleware,
  requireAuth,
  requireRole,
} from "../middleware/authMiddleware.js";

const router = express.Router();
router.use(authMiddleware);

// events
router.post("/events", requireAuth, createEvent);
router.get("/events", requireAuth, listEvents);

// admin/listing
router.get("/interviews", requireRole("admin"), listInterviews);

export default router;
