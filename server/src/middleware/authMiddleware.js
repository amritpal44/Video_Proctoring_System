import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "sid";

export async function authMiddleware(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE_NAME];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(payload.id).select("-passwordHash");
    if (user)
      req.user = {
        id: user._id,
        role: user.role,
        name: user.name,
        email: user.email,
      };
  } catch (err) {
    console.warn("auth verify failed", err.message);
  }
  return next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  next();
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "not_authenticated" });
    if (req.user.role !== role && req.user.role !== "admin")
      return res.status(403).json({ error: "forbidden" });
    next();
  };
}
