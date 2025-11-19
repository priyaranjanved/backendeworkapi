// models/hire.model.js
import mongoose from "mongoose";

const HireSchema = new mongoose.Schema({
  // preferred: ObjectId refs to User (optional)
  hirerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },
  workerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false, index: true },

  // fallback uid strings (required) so history is always saved
  hirerUid: { type: String, required: true, index: true },
  workerUid: { type: String, required: true, index: true },

  status: { type: String, enum: ["ongoing", "completed", "cancelled"], default: "completed" },
  startedAt: { type: Date, default: Date.now },
  endedAt: { type: Date, default: null },
  payment: { type: Number, default: 0 },
  notes: { type: String, default: "" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { timestamps: true });

export default mongoose.model("Hire", HireSchema);
