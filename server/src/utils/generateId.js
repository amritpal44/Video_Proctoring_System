import { sessions } from "../socket.js";

export function generateSessionId() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  let id;
  do {
    id = "";
    for (let i = 0; i < 12; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  } while (sessions[id]); // ensure not already used

  return id;
}

//PENDING
//these are also needed to be unique
