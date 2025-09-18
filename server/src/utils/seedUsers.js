import mongoose from "mongoose";
import User from "../models/User.js";
import dotenv from "dotenv";

dotenv.config();

const MONGO =
  process.env.MONGO_URI || "mongodb://localhost:27017/videoProctoring";

async function seed() {
  await mongoose.connect(MONGO, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  console.log("connected to mongo");
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@example.com";
  const adminPass = process.env.SEED_ADMIN_PASS || "adminpass";
  const interviewerEmail =
    process.env.SEED_INTERVIEWER_EMAIL || "interviewer@example.com";
  const interviewerPass =
    process.env.SEED_INTERVIEWER_PASS || "interviewerpass";

  const upsert = async (email, name, pass, role) => {
    let u = await User.findOne({ email });
    if (u) {
      console.log("user exists", email);
      return u;
    }
    u = await User.createWithPassword({ name, email, password: pass, role });
    console.log("created user", email, role);
    return u;
  };

  await upsert(adminEmail, "Admin", adminPass, "admin");
  await upsert(interviewerEmail, "Interviewer", interviewerPass, "interviewer");

  console.log("done");
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
