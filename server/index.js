// server/index.js
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ dest: "uploads/" });

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/videoProctoring";
mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });

const EventSchema = new mongoose.Schema({
  candidateName: String,
  event: { type: Object },
  createdAt: { type: Date, default: Date.now },
});
const Event = mongoose.model("Event", EventSchema);

const VideoSchema = new mongoose.Schema({
  candidateName: String,
  filename: String,
  path: String,
  size: Number,
  uploadedAt: { type: Date, default: Date.now },
});
const Video = mongoose.model("Video", VideoSchema);

// receive logs
app.post("/api/logs", async (req, res) => {
  try {
    const { candidateName, event } = req.body;
    const doc = await Event.create({ candidateName, event });
    res.json({ ok: true, id: doc._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// upload recorded video
app.post("/api/upload-video", upload.single("video"), async (req, res) => {
  try {
    const { candidateName } = req.body;
    const file = req.file;
    const destDir = path.join(__dirname, "saved_videos");
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
    const destPath = path.join(destDir, file.originalname);
    fs.renameSync(file.path, destPath);
    const vid = await Video.create({
      candidateName,
      filename: file.originalname,
      path: destPath,
      size: file.size,
    });
    res.json({ ok: true, id: vid._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// simple CSV report for candidate
app.get("/api/report/:candidateName/csv", async (req, res) => {
  try {
    const name = req.params.candidateName;
    const events = await Event.find({ candidateName: name })
      .sort({ createdAt: 1 })
      .lean();
    const rows = [["timestamp", "type", "detail"]];
    events.forEach((e) => {
      rows.push([
        new Date(e.createdAt).toISOString(),
        e.event.type || "",
        e.event.detail || "",
      ]);
    });
    const csv = rows
      .map((r) => r.map((c) => `"${(c + "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    res.setHeader(
      "Content-disposition",
      `attachment; filename=${name.replace(/\s+/g, "_")}_report.csv`
    );
    res.setHeader("Content-Type", "text/csv");
    res.send(csv);
  } catch (e) {
    res.status(500).send(e.message);
  }
});

app.get("/", (req, res) => {
  res.send("Video Proctoring Server is running.");
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log("Server listening on", PORT));
