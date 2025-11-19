// models/BusyRecord.js
import mongoose from "mongoose";

const BusyRecordSchema = new mongoose.Schema({
  targetUid: { type: String, required: true, index: true }, // user being marked busy
  byUid: { type: String, required: true },                  // who marked them busy
  startAt: { type: Date, required: true },
  endAt: { type: Date, default: null },                     // null while still busy
  durationMs: { type: Number, default: 0 }                  // filled when released (ms)
}, { timestamps: true });

export default mongoose.model("BusyRecord", BusyRecordSchema);
