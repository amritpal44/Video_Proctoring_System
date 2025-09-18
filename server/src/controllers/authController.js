import jwt from "jsonwebtoken";
import User from "../models/User.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";
const COOKIE_NAME = "sid";

export async function register(req, res) {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: "missing_fields" });
  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ error: "email_exists" });
    const user = await User.createWithPassword({ name, email, password, role });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax" });
    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("register error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "missing_fields" });
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ error: "invalid_credentials" });
    const ok = await user.verifyPassword(password);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });
    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, {
      expiresIn: "7d",
    });
    res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax" });
    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("login error", err);
    return res.status(500).json({ error: "server_error" });
  }
}

export async function logout(req, res) {
  res.clearCookie(COOKIE_NAME);
  return res.json({ ok: true });
}

export function getCurrentUser(req, res) {
  if (!req.user) return res.status(401).json({ error: "not_authenticated" });
  const { id, role } = req.user;
  return res.json({ user: { id, role } });
}
