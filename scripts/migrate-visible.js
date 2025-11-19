// scripts/migrate-visible.js
import mongoose from "mongoose";
import Work from "../src/models/work.js"; // adjust path if needed
import dotenv from "dotenv";
dotenv.config();

async function migrate() {
  if (!process.env.MONGO_URI) {
    console.error("Set MONGO_URI in .env");
    process.exit(1);
  }
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const result = await Work.updateMany(
      { visible: { $exists: false } },
      { $set: { visible: true, visibleChangedAt: new Date() } }
    );
    console.log("Migration result:", result);
  } catch (e) {
    console.error("Migration error:", e);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}
migrate();
