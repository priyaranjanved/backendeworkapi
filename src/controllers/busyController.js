// controllers/busyController.js
import { allocateBusy, releaseBusy, getRemainingMs, recalcWindowTotals } from "../lib/busyHelpers.js";
import BusyRecord from "../models/BusyRecord.js";
import BusyWindow from "../models/BusyWindow.js";

export async function allocate(req, res) {
  try {
    const { targetUid, byUid, hours } = req.body;
    if (!targetUid || !byUid || !hours) return res.status(400).json({ error: "Missing fields" });
    const requestedMs = Math.round(Number(hours) * 3600 * 1000);
    const result = await allocateBusy({ targetUid, byUid, requestedMs });
    return res.json({
      success: true,
      grantedHours: result.grantedMs / 3600000,
      remainingHours: result.remainingMs / 3600000,
      record: result.record
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
}

export async function release(req, res) {
  try {
    const { recordId } = req.body;
    if (!recordId) return res.status(400).json({ error: "recordId required" });
    const rec = await releaseBusy(recordId);
    return res.json({ success: true, record: rec });
  } catch (e) {
    return res.status(400).json({ success: false, error: e.message });
  }
}

export async function status(req, res) {
  try {
    const uid = req.params.uid;
    const w = await BusyWindow.findOne({ uid });
    await recalcWindowTotals(uid); // ensure fresh numbers
    const fresh = await BusyWindow.findOne({ uid });
    const remainingHours = Math.max(0, (8*3600000 - fresh.totalBusyMs) / 3600000);
    return res.json({
      success: true,
      uid,
      isEnabled: fresh.isEnabled,
      totalBusyHoursInWindow: Number((fresh.totalBusyMs / 3600000).toFixed(3)),
      remainingHours: Number(remainingHours.toFixed(3)),
      nextEnableAt: fresh.nextEnableAt
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export async function manualEnable(req, res) {
  try {
    const { uid } = req.body;
    if (!uid) return res.status(400).json({ error: "uid required" });
    const w = await BusyWindow.findOne({ uid });
    if (!w) return res.status(404).json({ error: "Window not found" });

    if (w.nextEnableAt && Date.now() < w.nextEnableAt.getTime()) {
      return res.status(400).json({ error: "Cannot enable yet. Allowed after: " + w.nextEnableAt });
    }
    w.isEnabled = true;
    w.nextEnableAt = null;
    await w.save();
    return res.json({ success: true, message: "Enabled", uid });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
