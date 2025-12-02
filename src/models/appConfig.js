import mongoose from "mongoose";

const appConfigSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, unique: true },

    // Business marker icon
    businessIcon: { type: String },

    // Center user location icon
    centerUserIcon: { type: String },

    // Work / Skill provider icon (bag wali)
    workerIcon: { type: String },

    // ⭐ NEW — Worker Skill Seeker icon (bag lekar chalta hua user)
    skillIcon: { type: String }
  },
  { timestamps: true }
);

export default mongoose.model("AppConfig", appConfigSchema);
