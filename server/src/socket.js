export const sessions = {};

export function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    console.log("New socket connected:", socket.id);

    socket.on("join_session", ({ sessionId, role, name }) => {
      const session = sessions[sessionId];
      if (!session) {
        socket.emit("error_message", "Invalid session ID");
        return;
      }

      if (role === "interviewer") {
        if (
          session.interviewer.socketId &&
          session.interviewer.socketId !== socket.id
        ) {
          socket.emit("error_message", "Interviewer already connected");
          return;
        }
        session.interviewer.socketId = socket.id;
        session.interviewer.name = name;
      } else if (role === "candidate") {
        if (
          session.candidate &&
          session.candidate.socketId &&
          session.candidate.socketId !== socket.id
        ) {
          socket.emit("error_message", "Candidate already connected");
          return;
        }
        session.candidate = { name, socketId: socket.id };
      } else {
        socket.emit("error_message", "Invalid role");
        return;
      }

      socket.join(sessionId);
      io.to(sessionId).emit("user_joined", { role, name });
      console.log(`${name} joined ${sessionId} as ${role}`);
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
      // Optional: cleanup session if needed
    });
  });
}
