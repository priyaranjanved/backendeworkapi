// lib/busyHelpers.js
import BusyRecord from "../models/BusyRecord.js";
import BusyWindow from "../models/BusyWindow.js";

const MS_IN_HOUR = 3600 * 1000;
const WINDOW_MS = 24 * MS_IN_HOUR;
const MAX_BUSY_MS = 8 * MS_IN_HOUR;
const BLOCK_DURATION_MS = 15 * MS_IN_HOUR;

export async function ensureWindow(uid) {
  let w = await BusyWindow.findOne({ uid });
  if (!w) {
    w = await BusyWindow.create({ uid, windowStart: new Date(), totalBusyMs: 0, isEnabled: true });
  } else {
    // if windowStart older than 24h, reset
    const now = Date.now();
    if (now - w.windowStart.getTime() >= WINDOW_MS) {
      w.windowStart = new Date();
      w.totalBusyMs = 0;
      // Do not auto-enable if nextEnableAt in future; keep isEnabled as appropriate
      if (w.nextEnableAt && now < w.nextEnableAt.getTime()) {
        w.isEnabled = false;
      } else {
        w.isEnabled = true;
        w.nextEnableAt = null;
      }
      await w.save();
    }
  }
  return w;
}

export async function getRemainingMs(uid) {
  const w = await ensureWindow(uid);
  return Math.max(0, MAX_BUSY_MS - w.totalBusyMs);
}

// allocate busy: start a BusyRecord (endAt null). returns record or throws error
export async function allocateBusy({ targetUid, byUid, requestedMs }) {
  const w = await ensureWindow(targetUid);
  if (!w.isEnabled) {
    throw new Error("Target user currently not accepting busy allocations (disabled).");
  }
  const remaining = Math.max(0, MAX_BUSY_MS - w.totalBusyMs);
  if (remaining <= 0) {
    // auto-block and set nextEnableAt
    w.isEnabled = false;
    w.nextEnableAt = new Date(Date.now() + BLOCK_DURATION_MS);
    await w.save();
    throw new Error("Max busy limit reached; user blocked. Try after: " + w.nextEnableAt);
  }

  const grantMs = Math.min(remaining, requestedMs);
  // Create BusyRecord with provisional endAt null; we will set duration on release
  const rec = await BusyRecord.create({
    targetUid,
    byUid,
    startAt: new Date(),
    endAt: new Date(Date.now() + grantMs),
    durationMs: grantMs
  });

  // Immediately increment totalBusyMs by granted duration (since you count from allocation start)
  w.totalBusyMs = w.totalBusyMs + grantMs;
  if (w.totalBusyMs >= MAX_BUSY_MS) {
    w.isEnabled = false;
    w.nextEnableAt = new Date(Date.now() + BLOCK_DURATION_MS);
  }
  await w.save();

  return { record: rec, grantedMs: grantMs, remainingMs: Math.max(0, MAX_BUSY_MS - w.totalBusyMs) };
}

// release: mark the record ended earlier than endAt (optional)
export async function releaseBusy(recordId) {
  const rec = await BusyRecord.findById(recordId);
  if (!rec) throw new Error("Record not found");
  if (rec.endAt && rec.endAt.getTime() <= Date.now()) {
    // already ended naturally
    return rec;
  }
  const actualEnd = new Date();
  const actualDuration = actualEnd.getTime() - rec.startAt.getTime();
  rec.endAt = actualEnd;
  rec.durationMs = actualDuration;
  await rec.save();

  // update the window totals: we recalc window total from BusyRecords to be safe
  await recalcWindowTotals(rec.targetUid);
  return rec;
}

export async function recalcWindowTotals(uid) {
  const windowStart = new Date(Date.now() - WINDOW_MS);
  const recs = await BusyRecord.find({
    targetUid: uid,
    startAt: { $gte: windowStart }
  });

  const totalMs = recs.reduce((acc, r) => acc + (r.durationMs || ( (r.endAt ? r.endAt.getTime()-r.startAt.getTime():0) )), 0);
  const w = await ensureWindow(uid);
  w.windowStart = new Date(); // keep window anchored to now for simplicity
  w.totalBusyMs = totalMs;
  if (totalMs >= MAX_BUSY_MS) {
    w.isEnabled = false;
    if (!w.nextEnableAt) w.nextEnableAt = new Date(Date.now() + BLOCK_DURATION_MS);
  } else {
    // if nextEnableAt in past, allow enable
    if (w.nextEnableAt && Date.now() >= w.nextEnableAt.getTime()) {
      w.isEnabled = true;
      w.nextEnableAt = null;
    }
  }
  await w.save();
  return w;
}
