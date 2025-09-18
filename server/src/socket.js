// server/src/socket.js
// Robust Socket.IO signaling with session state, stream start/stop, and reconnect handling

export const sessions = {}; // in-memory session store

import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Interview from "./models/Interview.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach((c) => {
    const idx = c.indexOf("=");
    if (idx === -1) return;
    const k = c.slice(0, idx).trim();
    const v = c.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function broadcastSession(io, sessionId) {
  const s = sessions[sessionId];
  io.to(sessionId).emit("session_update", {
    sessionId,
    interviewId: s.interviewId || null,
    interviewer: s.interviewer
      ? {
          name: s.interviewer.name,
          connected: !!s.interviewer.connected,
          userId: s.interviewer.userId || null,
        }
      : null,
    candidate: s.candidate
      ? {
          name: s.candidate.name,
          connected: !!s.candidate.connected,
          streaming: !!s.candidate.streaming,
          screenSharing: !!s.candidate.screenSharing,
          userId: s.candidate.userId || null,
        }
      : null,
    lastUpdate: s.lastUpdate,
  });
}

export function registerSocketHandlers(io) {
  io.on("connection", async (socket) => {
    console.log("[io] connect", socket.id);

    // try to parse cookie and attach user to socket
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie || "");
      const token =
        cookies.sid ||
        cookies.SID ||
        cookies[process.env.AUTH_COOKIE_NAME || "sid"];
      if (token) {
        const payload = jwt.verify(token, JWT_SECRET);
        // optional: load minimal user info
        const u = await User.findById(payload.id).select("name role");
        if (u) {
          socket.user = { id: u._id.toString(), name: u.name, role: u.role };
          console.log(
            "[io] socket authenticated user",
            socket.user.id,
            socket.user.role
          );
        }
      }
    } catch (err) {
      // invalid token - socket remains unauthenticated
      console.warn("[io] socket auth failed", err.message);
    }

    // Optionally enforce that sockets must be authenticated. Set REQUIRE_SOCKET_AUTH=1 in .env to enable
    const REQUIRE_SOCKET_AUTH = process.env.REQUIRE_SOCKET_AUTH === "1";
    if (REQUIRE_SOCKET_AUTH && !socket.user) {
      // Don't immediately disconnect here - some browsers/clients may need to receive the error.
      // Mark the socket as requiring auth and emit a clear error; enforce at join_session instead.
      console.log(
        "[io] unauthenticated socket connected (auth required):",
        socket.id
      );
      socket.authRequired = true;
      socket.emit("signal_error", { msg: "authentication_required" });
      // continue - join_session will enforce authentication when attempting to join
    }

    socket.on("join_session", ({ sessionId, role, name }) => {
      // enforce auth at join time if required
      if (REQUIRE_SOCKET_AUTH && !socket.user) {
        socket.emit("signal_error", { msg: "authentication_required" });
        return;
      }
      const session = sessions[sessionId];
      if (!session) {
        socket.emit("signal_error", { msg: "Invalid session ID" });
        return;
      }

      // Check if someone with the same role is already connected
      if (role === "interviewer" && session.interviewer?.connected) {
        socket.emit("signal_error", {
          msg: "An interviewer is already in this session",
        });
        return;
      } else if (role === "candidate" && session.candidate?.connected) {
        socket.emit("signal_error", {
          msg: "A candidate is already in this session",
        });
        return;
      }

      // join socket.io room
      socket.join(sessionId);

      // update session state depending on role
      session.lastUpdate = new Date().toISOString();
      if (role === "interviewer") {
        // allow rejoin: update socketId and connected flag
        session.interviewer = session.interviewer || {
          name: name || "Interviewer",
          socketId: null,
          connected: false,
        };
        session.interviewer.name =
          (socket.user && socket.user.name) || name || session.interviewer.name;
        session.interviewer.socketId = socket.id;
        session.interviewer.connected = true;
        if (socket.user) session.interviewer.userId = socket.user.id;
        console.log(`[session:${sessionId}] interviewer joined (${socket.id})`);
      } else if (role === "candidate") {
        session.candidate = session.candidate || {
          name: name || "Candidate",
          socketId: null,
          connected: false,
          streaming: false,
        };
        session.candidate.name =
          (socket.user && socket.user.name) || name || session.candidate.name;
        session.candidate.socketId = socket.id;
        session.candidate.connected = true;
        if (socket.user) session.candidate.userId = socket.user.id;
        console.log(`[session:${sessionId}] candidate joined (${socket.id})`);
      } else {
        socket.emit("signal_error", { msg: "Invalid role" });
        return;
      }

      // inform room of new state
      broadcastSession(io, sessionId);
    });

    // Candidate says "I started streaming"
    socket.on("stream-started", ({ sessionId }) => {
      const s = sessions[sessionId];
      if (!s) return;
      if (s.candidate && s.candidate.socketId === socket.id) {
        s.candidate.streaming = true;
        s.lastUpdate = new Date().toISOString();
        broadcastSession(io, sessionId);
        console.log(`[session:${sessionId}] candidate started stream`);
      }
    });

    // Candidate says "I stopped streaming"
    socket.on("stream-stopped", ({ sessionId }) => {
      const s = sessions[sessionId];
      if (!s) return;
      if (s.candidate && s.candidate.socketId === socket.id) {
        s.candidate.streaming = false;
        s.lastUpdate = new Date().toISOString();
        broadcastSession(io, sessionId);
        console.log(`[session:${sessionId}] candidate stopped stream`);
      }
    });

    // interviewer requests candidate to send a fresh offer (useful after refresh or reconnect)
    socket.on("request-offer", ({ sessionId }) => {
      // forward to candidate socket
      const s = sessions[sessionId];
      if (!s) {
        socket.emit("signal_error", { msg: "Invalid session ID" });
        return;
      }
      if (!s.candidate || !s.candidate.socketId) {
        socket.emit("signal_error", { msg: "Candidate not connected" });
        return;
      }
      io.to(s.candidate.socketId).emit("request-offer");
      console.log(
        `[session:${sessionId}] interviewer requested offer from candidate`
      );
    });

    // WebRTC signal forwarders
    socket.on("webrtc-offer", ({ sessionId, sdp }) => {
      socket.to(sessionId).emit("webrtc-offer", { sdp });
    });

    socket.on("webrtc-answer", ({ sessionId, sdp }) => {
      socket.to(sessionId).emit("webrtc-answer", { sdp });
    });

    socket.on("webrtc-ice-candidate", ({ sessionId, candidate }) => {
      socket.to(sessionId).emit("webrtc-ice-candidate", { candidate });
    });

    socket.on("disconnect", () => {
      console.log("[io] disconnect", socket.id);
      // find any session that had this socket and mark as disconnected
      for (const sid of Object.keys(sessions)) {
        const s = sessions[sid];
        let changed = false;
        if (s.interviewer && s.interviewer.socketId === socket.id) {
          s.interviewer.connected = false;
          s.interviewer.socketId = null;
          changed = true;
          console.log(`[session:${sid}] interviewer disconnected`);
        }
        if (s.candidate && s.candidate.socketId === socket.id) {
          s.candidate.connected = false;
          // keep streaming=false to indicate stream stopped on disconnect
          s.candidate.streaming = false;
          s.candidate.screenSharing = false; // reset screen sharing state on disconnect
          s.candidate.socketId = null;
          changed = true;
          console.log(`[session:${sid}] candidate disconnected`);
        }
        if (changed) {
          s.lastUpdate = new Date().toISOString();
          // broadcast new state
          io.to(sid).emit("session_update", {
            sessionId: sid,
            interviewId: s.interviewId || null,
            interviewer: s.interviewer
              ? {
                  name: s.interviewer.name,
                  connected: !!s.interviewer.connected,
                  userId: s.interviewer.userId || null,
                }
              : null,
            candidate: s.candidate
              ? {
                  name: s.candidate.name,
                  connected: !!s.candidate.connected,
                  streaming: !!s.candidate.streaming,
                  userId: s.candidate.userId || null,
                }
              : null,
            lastUpdate: s.lastUpdate,
          });

          // If both participants exist and both are disconnected, mark interview as ended
          try {
            if (
              s.interviewer &&
              s.candidate &&
              !s.interviewer.connected &&
              !s.candidate.connected &&
              s.interviewId
            ) {
              // set endTime on interview doc (best-effort)
              Interview.findByIdAndUpdate(s.interviewId, {
                endTime: new Date(),
              })
                .then(() =>
                  console.log("[io] interview auto-closed", s.interviewId)
                )
                .catch((e) =>
                  console.warn("[io] failed to auto-close interview", e.message)
                );
            }
          } catch (e) {
            console.warn("[io] auto-close error", e.message);
          }
        }
      }
    });

    // candidate health ping
    socket.on("candidate_screen_start", ({ sessionId }) => {
      const s = sessions[sessionId];
      if (!s) return;
      if (s.candidate && s.candidate.socketId === socket.id) {
        s.candidate.screenSharing = true;
        s.lastUpdate = new Date().toISOString();
        broadcastSession(io, sessionId);
        console.log(`[session:${sessionId}] candidate started screen sharing`);
      }
    });

    socket.on("candidate_screen_stop", ({ sessionId }) => {
      const s = sessions[sessionId];
      if (!s) return;
      if (s.candidate && s.candidate.socketId === socket.id) {
        s.candidate.screenSharing = false;
        s.lastUpdate = new Date().toISOString();
        broadcastSession(io, sessionId);
        console.log(`[session:${sessionId}] candidate stopped screen sharing`);
      }
    });

    socket.on("candidate-health", ({ sessionId, healthy }) => {
      const s = sessions[sessionId];
      if (!s) return;
      if (s.candidate) {
        s.candidate.streaming = healthy; // keep streaming flag in sync
        s.lastUpdate = new Date().toISOString();
        // Optionally store lastHealth timestamp
        s.candidate.lastHealth = { healthy, ts: s.lastUpdate };
        // broadcast state
        broadcastSession(io, sessionId);
        // io.to(sessionId).emit("session_update", {
        //   sessionId,
        //   interviewer: s.interviewer
        //     ? { name: s.interviewer.name, connected: !!s.interviewer.connected }
        //     : null,
        //   candidate: s.candidate
        //     ? {
        //         name: s.candidate.name,
        //         connected: !!s.candidate.connected,
        //         streaming: !!s.candidate.streaming,
        //       }
        //     : null,
        //   lastUpdate: s.lastUpdate,
        // });
      }
    });

    // socket.on("candidate_screen_start", ({ sessionId }) => {
    //   const s = sessions[sessionId];
    //   if (s && s.candidate) s.candidate.screen = true;
    //   io.to(sessionId).emit("session_update", s);
    // });

    // socket.on("candidate_screen_stop", ({ sessionId }) => {
    //   const s = sessions[sessionId];
    //   if (s && s.candidate) s.candidate.screen = false;
    //   io.to(sessionId).emit("candidate_screen_stop");
    //   io.to(sessionId).emit("session_update", s);
    // });
  });
}
