import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import dotenv from "dotenv";
import sessionRoutes from "./routes/sessionRoutes.js";
import { registerSocketHandlers } from "./socket.js";

dotenv.config();
const app = express();
const server = http.createServer(app);

// middlewares
app.use(cors());
app.use(express.json());

// REST routes
app.use("/api/sessions", sessionRoutes);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});
registerSocketHandlers(io);

// server listen
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
