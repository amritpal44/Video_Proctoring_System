import mongoose from "mongoose";

const ProctorEventSchema = new mongoose.Schema({
  interview: { type: mongoose.Schema.Types.ObjectId, ref: "Interview" },
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  type: { type: String, required: true }, // e.g. 'no_face', 'not_looking', 'multiple_faces'
  details: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
  severity: { type: Number, default: 1 },
});

export default mongoose.model("ProctorEvent", ProctorEventSchema);
