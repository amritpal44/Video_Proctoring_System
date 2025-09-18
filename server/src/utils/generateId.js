// server/src/utils/generateId.js
export function generateSimpleId(length = 12) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < length; i++)
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  return id;
}
