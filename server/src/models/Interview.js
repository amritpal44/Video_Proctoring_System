import mongoose from "mongoose";

const InterviewSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, index: true },
  title: { type: String },
  interviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  candidate: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  startTime: { type: Date },
  endTime: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("Interview", InterviewSchema);
