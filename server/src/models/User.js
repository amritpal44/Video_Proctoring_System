import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, index: true },
  passwordHash: { type: String, required: true },
  role: {
    type: String,
    enum: ["candidate", "interviewer", "admin"],
    default: "candidate",
  },
  createdAt: { type: Date, default: Date.now },
});

UserSchema.methods.verifyPassword = function (password) {
  return bcrypt.compare(password, this.passwordHash);
};

UserSchema.statics.createWithPassword = async function ({
  name,
  email,
  password,
  role = "candidate",
}) {
  const hash = await bcrypt.hash(password, 10);
  return this.create({ name, email, passwordHash: hash, role });
};

export default mongoose.model("User", UserSchema);
