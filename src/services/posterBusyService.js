// src/services/posterBusyService.js
import Work from "../models/work.js"; // adjust path if needed

/**
 * Set poster.posterBusy flag on all Work docs for a given poster UID.
 * - posterUid: the UID string stored in poster.uid or postedByUid
 * - isBusy: boolean
 */
export async function setPosterBusy(posterUid, isBusy) {
  if (!posterUid) return { ok: false, reason: "no posterUid" };
  try {
    const res = await Work.updateMany(
      { $or: [{ postedByUid: posterUid }, { "poster.uid": posterUid }] },
      { $set: { "poster.posterBusy": !!isBusy } }
    );
    // res contains { acknowledged, modifiedCount, matchedCount, ... }
    return { ok: true, res };
  } catch (err) {
    console.error("setPosterBusy error:", err);
    return { ok: false, error: err.message || err };
  }
}
