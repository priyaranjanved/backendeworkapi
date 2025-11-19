// models/BusyWindow.js
import mongoose from "mongoose";

/**
 * BusyWindow tracks per-user rolling 24h cycle state.
 * We DO NOT touch User schema. This document controls enable/disable.
 */
const BusyWindowSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, index: true },
  windowStart: { type: Date, required: true },    // start of current 24h window
  totalBusyMs: { type: Number, default: 0 },      // total busy ms inside this window
  isEnabled: { type: Boolean, default: true },    // whether user accept new busy allocations
  nextEnableAt: { type: Date, default: null }     // when user is allowed to enable again (after auto-off)
}, { timestamps: true });

export default mongoose.model("BusyWindow", BusyWindowSchema);
