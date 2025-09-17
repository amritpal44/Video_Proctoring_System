import { io } from "socket.io-client";

const socket = io("http://localhost:4000");

socket.on("connect", () => {
  console.log("Connected as", socket.id);

  // join as interviewer
  socket.emit("join_session", {
    sessionId: "HpMPgH", // replace with the one you got from API
    role: "candidate",
    name: "Harpal"
  });
});

socket.on("user_joined", (data) => {
  console.log("User joined event:", data);
});

socket.on("error_message", (msg) => {
  console.log("Error:", msg);
});
