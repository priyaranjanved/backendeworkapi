// routes/engage.js
import { Router } from "express";
import EngageStatus from "../models/engage.model.js";
import User from "../models/user.js";
import Hire from "../models/hire.model.js"; // make sure path is correct
import { setPosterBusy } from "../services/posterBusyService.js"; // NEW: poster busy service

const router = Router();

async function ensureStatus(userId) {
  let doc = await EngageStatus.findOne({ userId });
  if (!doc) doc = await EngageStatus.create({ userId, status: "free", workId: null }); // CHANGED: ensure workId exists
  return doc;
}

/* GET /api/engage/busy */
router.get("/busy", async (req, res) => {
  try {
    const docs = await EngageStatus.find({ status: "busy" }).lean();
    if (!docs || docs.length === 0) return res.json({ isSuccess: true, data: [] });

    const ids = docs.map((d) => d.userId).filter(Boolean);
    const usersByUid = await User.find({ uid: { $in: ids } }).lean();
    const byUid = usersByUid.reduce((acc, u) => { acc[u.uid] = u; return acc; }, {});

    const missingIds = ids.filter((id) => !byUid[id]);
    let byAadhaar = {};
    if (missingIds.length > 0) {
      const usersByAad = await User.find({ aadhaar: { $in: missingIds } }).lean();
      byAadhaar = usersByAad.reduce((acc, u) => { acc[u.aadhaar] = u; return acc; }, {});
    }

    const out = docs.map((d) => {
      const userFound = byUid[d.userId] || byAadhaar[d.userId] || null;
      const user = userFound ? {
        uid: userFound.uid || d.userId,
        name: userFound.name || "Unknown",
        mobile: userFound.mobile || "—",
        aadhaar: userFound.aadhaar || d.userId || "—",
        gender: userFound.gender || null,
        age: userFound.age ?? null
      } : {
        uid: d.userId,
        name: "Unknown",
        mobile: "—",
        aadhaar: d.userId,
        gender: null,
        age: null
      };

      return {
        userId: d.userId,
        status: d.status,
        engagedBy: d.engagedBy,
        engagedAt: d.engagedAt,
        expiresAt: d.expiresAt,
        workId: d.workId || null, // CHANGED: include workId
        user
      };
    });

    return res.json({ isSuccess: true, data: out });
  } catch (e) {
    console.error("GET /api/engage/busy failed", e);
    return res.status(500).json({ isSuccess: false, error: "BUSY_LIST_ERROR" });
  }
});

/* GET /api/engage/status/:userId */
router.get("/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const doc = await ensureStatus(userId);

    return res.json({
      isSuccess: true,
      data: {
        userId: doc.userId,
        status: doc.status,
        engagedBy: doc.engagedBy,
        engagedAt: doc.engagedAt,
        expiresAt: doc.expiresAt,
        workId: doc.workId || null // CHANGED: include workId
      }
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ isSuccess: false, error: "STATUS_ERROR" });
  }
});

/* POST /api/engage/try */
router.post("/try", async (req, res) => {
  try {
    const { userId, engagerId, ttlSeconds = null, workId = null } = req.body; // CHANGED: accept workId
    if (!userId || !engagerId) return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });

    const now = new Date();
    const exp = (typeof ttlSeconds === "number" && ttlSeconds > 0) ? new Date(now.getTime() + ttlSeconds * 1000) : null;

    let doc = await ensureStatus(userId);

    // idempotent if same engager already owns this busy lock
    if (doc.status === "busy" && String(doc.engagedBy) === String(engagerId)) {
      if (exp) doc.expiresAt = exp;
      doc.engagedAt = doc.engagedAt || now;

      // CHANGED: if client provided a workId, persist/update it on existing lock
      if (workId) doc.workId = workId;

      await doc.save();

      // ensure flag is set (idempotent)
      try {
        await setPosterBusy(userId, true);
      } catch (e) {
        console.warn("setPosterBusy warning (idempotent):", e);
      }

      return res.json({
        isSuccess: true,
        data: { status: doc.status, engagedBy: doc.engagedBy, expiresAt: doc.expiresAt, workId: doc.workId || null }
      });
    }

    const updated = await EngageStatus.findOneAndUpdate(
      { userId, status: "free" },
      { $set: { status: "busy", engagedBy: engagerId, engagedAt: now, expiresAt: exp, workId: workId || null } }, // CHANGED: store workId
      { new: true }
    );

    if (!updated) {
      const cur = await EngageStatus.findOne({ userId }).lean();
      return res.json({ isSuccess: false, data: { status: cur?.status || "busy", engagedBy: cur?.engagedBy || null, workId: cur?.workId || null }, error: "ALREADY_BUSY" });
    }

    // NEW: mark poster busy in Work docs (await for consistency)
    try {
      await setPosterBusy(userId, true);
    } catch (e) {
      console.warn("Warning: setPosterBusy failed on try:", e);
      // continue; engagement succeeded even if denorm failed
    }

    return res.json({
      isSuccess: true,
      data: { status: updated.status, engagedBy: updated.engagedBy, expiresAt: updated.expiresAt, engagedAt: updated.engagedAt, workId: updated.workId || null }
    });
  } catch (e) {
    if (e?.code === 11000) return res.json({ isSuccess: false, data: { status: "busy" }, error: "ALREADY_BUSY" });
    console.error(e);
    return res.status(500).json({ isSuccess: false, error: "TRY_ERROR" });
  }
});

/* POST /api/engage/heartbeat */
router.post("/heartbeat", async (req, res) => {
  try {
    const { userId, engagerId, extendSeconds = 60 } = req.body;
    if (!userId || !engagerId) return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });

    const doc = await EngageStatus.findOne({ userId });
    const now = new Date();

    if (!doc || doc.status !== "busy" || String(doc.engagedBy) !== String(engagerId)) return res.json({ isSuccess: false, error: "NOT_OWNER" });

    doc.expiresAt = new Date(now.getTime() + extendSeconds * 1000);
    await doc.save();
    return res.json({ isSuccess: true, data: { expiresAt: doc.expiresAt } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ isSuccess: false, error: "HEARTBEAT_ERROR" });
  }
});

/**
 * POST /api/engage/release
 * body: { userId, engagerId, createHireRecord=true|false, payment=0, notes="", metadata={} }
 *
 * IMPORTANT: capture engagedAt BEFORE nulling it, so history gets correct startedAt.
 */
router.post("/release", async (req, res) => {
  try {
    const {
      userId,
      engagerId,
      createHireRecord = true,
      payment = 0,
      notes = "",
      metadata = {}
    } = req.body;

    console.log("ENGAGE.RELEASE called:", { userId, engagerId, createHireRecord, payment });

    if (!userId || !engagerId) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });
    }

    const doc = await EngageStatus.findOne({ userId });
    if (!doc) {
      return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
    }
    if (doc.status !== "busy") {
      return res.status(400).json({ isSuccess: false, error: "NOT_BUSY" });
    }
    if (String(doc.engagedBy) !== String(engagerId)) {
      return res.status(403).json({ isSuccess: false, error: "NOT_OWNER" });
    }

    // capture engagedAt BEFORE clearing
    const capturedEngagedAt = doc.engagedAt ? new Date(doc.engagedAt) : new Date();
    const capturedWorkId = doc.workId || null; // CHANGED: capture workId for hire record / response

    // 1) release engage (clear lock)
    doc.status = "free";
    doc.engagedBy = null;
    doc.engagedAt = null;
    doc.expiresAt = null;
    doc.workId = null; // CHANGED: clear stored workId
    await doc.save();
    console.log("ENGAGE.RELEASE: released engage for", userId);

    // 2) IMPORTANT: clear posterBusy on Work docs so poster's works become visible again
    try {
      await setPosterBusy(userId, false);
    } catch (e) {
      console.warn("Warning: setPosterBusy failed on release:", e);
      // continue: release succeeded; warn only
    }

    // 3) optionally create hire record using capturedEngagedAt as startedAt
    let hireRecord = null;
    if (createHireRecord) {
      try {
        const hirerDoc = await User.findOne({ uid: engagerId }).lean();
        const workerDoc = await User.findOne({ uid: userId }).lean();

        const hirePayload = {
          hirerUid: String(engagerId),
          workerUid: String(userId),
          status: "completed",
          startedAt: capturedEngagedAt,
          endedAt: new Date(),
          payment: typeof payment === "number" ? payment : Number(payment || 0),
          notes: notes || `Released by ${engagerId}`,
          metadata: metadata || {},
          workId: capturedWorkId // CHANGED: attach workId to hire record
        };

        // include object ids if documents exist
        if (hirerDoc && hirerDoc._id) hirePayload.hirerId = hirerDoc._id;
        if (workerDoc && workerDoc._id) hirePayload.workerId = workerDoc._id;

        console.log("ENGAGE.RELEASE: creating hirePayload:", hirePayload);

        const created = await Hire.create(hirePayload);
        hireRecord = await Hire.findById(created._id).populate({ path: "workerId", select: "uid name mobile aadhaar gender age" }).lean();

        console.log("ENGAGE.RELEASE: hire created id=", created._id);
      } catch (hireErr) {
        console.error("ENGAGE.RELEASE: failed to create hire record:", hireErr);
        // release succeeded; respond with warning but success
        return res.json({ isSuccess: true, data: { status: "free" }, warning: "HIRE_CREATE_FAILED", errorDetail: (hireErr && hireErr.message) || null });
      }
    }

    return res.json({ isSuccess: true, data: { status: "free", hire: hireRecord, workId: capturedWorkId } });
  } catch (e) {
    console.error("ENGAGE.RELEASE error:", e);
    return res.status(500).json({ isSuccess: false, error: "RELEASE_ERROR", errorDetail: e.message });
  }
});

export default router;
