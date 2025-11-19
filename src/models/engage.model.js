// models/engage.model.js
import mongoose from "mongoose";

const EngageSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true }, // user being engaged (worker uid)
  status: { type: String, enum: ["free", "busy"], default: "free" },
  engagedBy: { type: String, default: null }, // engager uid (device/user doing engage)
  engagedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null },

  // NEW: reference to the work/listing that this engage is for (can be null)
  workId: { type: mongoose.Schema.Types.ObjectId, ref: "Work", default: null },

  // optional: cache some work metadata to avoid extra joins on quick flows
  workTitle: { type: String, default: null },
  workLocation: { type: Object, default: null }, // { lat, lon } or whatever shape your app uses
}, { timestamps: true });

// If you want to auto-expire based on expiresAt uncomment
// EngageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("EngageStatus", EngageSchema);
