import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import dotenv from "dotenv";
import mongoose from "mongoose";
import sessionRoutes from "./routes/sessionRoutes.js";
import cookieParser from "cookie-parser";
import authRoutes from "./routes/authRoutes.js";
import proctorRoutes from "./routes/proctorRoutes.js";
import { registerSocketHandlers } from "./socket.js";

dotenv.config();
const app = express();
const server = http.createServer(app);

// MongoDB connection
const MONGO =
  process.env.MONGO_URI || "mongodb://localhost:27017/videoProctoring";
mongoose
  .connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => {
    console.error("MongoDB connection error", err.message || err);
  });

mongoose.connection.on("error", (err) =>
  console.error("Mongoose connection error", err)
);
mongoose.connection.on("disconnected", () =>
  console.warn("Mongoose disconnected")
);

// middlewares
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5173";
app.use(cors({ origin: FRONTEND_ORIGIN, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// REST routes
app.use("/api/sessions", sessionRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/proctor", proctorRoutes);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true,
  },
});
registerSocketHandlers(io);

// server listen
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
