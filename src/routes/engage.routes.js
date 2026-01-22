// routes/engage.js
import { Router } from "express";
import EngageStatus from "../models/engage.model.js";
import KycCardUser from "../models/KycCardUser.js";   // ✅ CHANGED
import Hire from "../models/hire.model.js";
import { setPosterBusy } from "../services/posterBusyService.js";

const router = Router();

async function ensureStatus(userId) {
  let doc = await EngageStatus.findOne({ userId });
  if (!doc) doc = await EngageStatus.create({ userId, status: "free", workId: null });
  return doc;
}

/* ======================= BUSY LIST ======================= */
/* GET /api/engage/busy */
router.get("/busy", async (req, res) => {
  try {
    const docs = await EngageStatus.find({ status: "busy" }).lean();
    if (!docs || docs.length === 0) return res.json({ isSuccess: true, data: [] });

    const ids = docs.map((d) => d.userId).filter(Boolean);

    // ✅ NOW FETCH FROM KYC COLLECTION
    const usersByUid = await KycCardUser.find({ uid: { $in: ids } }).lean();
    const byUid = usersByUid.reduce((acc, u) => {
      acc[u.uid] = u;
      return acc;
    }, {});

    const out = docs.map((d) => {
      const userFound = byUid[d.userId] || null;

      const user = userFound
        ? {
            uid: userFound.uid,
            name: userFound.fullName,        // ✅ fullName used
            mobile: userFound.mobile || "—",
            aadhaar: userFound.uid || d.userId,
            gender: userFound.gender || null,
            age: userFound.age ?? null,
            facePhoto: userFound.facePhoto || null,
            planType: userFound.planType || "Basic",
          }
        : {
            uid: d.userId,
            name: "Unknown",
            mobile: "—",
            aadhaar: d.userId,
            gender: null,
            age: null,
            facePhoto: null,
            planType: null,
          };

      return {
        userId: d.userId,
        status: d.status,
        engagedBy: d.engagedBy,
        engagedAt: d.engagedAt,
        expiresAt: d.expiresAt,
        workId: d.workId || null,
        user,                               // ✅ frontend yahi se name lega
      };
    });

    return res.json({ isSuccess: true, data: out });
  } catch (e) {
    console.error("GET /api/engage/busy failed", e);
    return res.status(500).json({ isSuccess: false, error: "BUSY_LIST_ERROR" });
  }
});

/* ======================= STATUS ======================= */
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
        workId: doc.workId || null,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ isSuccess: false, error: "STATUS_ERROR" });
  }
});

/* ======================= TRY ENGAGE ======================= */
router.post("/try", async (req, res) => {
  try {
    const { userId, engagerId, ttlSeconds = null, workId = null } = req.body;
    if (!userId || !engagerId) return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });

    const now = new Date();
    const exp = (typeof ttlSeconds === "number" && ttlSeconds > 0)
      ? new Date(now.getTime() + ttlSeconds * 1000)
      : null;

    let doc = await ensureStatus(userId);

    if (doc.status === "busy" && String(doc.engagedBy) === String(engagerId)) {
      if (exp) doc.expiresAt = exp;
      doc.engagedAt = doc.engagedAt || now;
      if (workId) doc.workId = workId;

      await doc.save();

      try { await setPosterBusy(userId, true); } catch {}

      return res.json({
        isSuccess: true,
        data: { status: doc.status, engagedBy: doc.engagedBy, expiresAt: doc.expiresAt, workId: doc.workId || null },
      });
    }

    const updated = await EngageStatus.findOneAndUpdate(
      { userId, status: "free" },
      { $set: { status: "busy", engagedBy: engagerId, engagedAt: now, expiresAt: exp, workId: workId || null } },
      { new: true }
    );

    if (!updated) {
      const cur = await EngageStatus.findOne({ userId }).lean();
      return res.json({ isSuccess: false, data: { status: cur?.status || "busy", engagedBy: cur?.engagedBy || null, workId: cur?.workId || null }, error: "ALREADY_BUSY" });
    }

    try { await setPosterBusy(userId, true); } catch {}

    return res.json({
      isSuccess: true,
      data: { status: updated.status, engagedBy: updated.engagedBy, expiresAt: updated.expiresAt, engagedAt: updated.engagedAt, workId: updated.workId || null },
    });
  } catch (e) {
    if (e?.code === 11000) return res.json({ isSuccess: false, data: { status: "busy" }, error: "ALREADY_BUSY" });
    console.error(e);
    return res.status(500).json({ isSuccess: false, error: "TRY_ERROR" });
  }
});

/* ======================= RELEASE ======================= */
router.post("/release", async (req, res) => {
  try {
    const { userId, engagerId, createHireRecord = true, payment = 0, notes = "", metadata = {} } = req.body;

    if (!userId || !engagerId) return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });

    const doc = await EngageStatus.findOne({ userId });
    if (!doc) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
    if (doc.status !== "busy") return res.status(400).json({ isSuccess: false, error: "NOT_BUSY" });
    if (String(doc.engagedBy) !== String(engagerId)) return res.status(403).json({ isSuccess: false, error: "NOT_OWNER" });

    const capturedEngagedAt = doc.engagedAt ? new Date(doc.engagedAt) : new Date();
    const capturedWorkId = doc.workId || null;

    doc.status = "free";
    doc.engagedBy = null;
    doc.engagedAt = null;
    doc.expiresAt = null;
    doc.workId = null;
    await doc.save();

    try { await setPosterBusy(userId, false); } catch {}

    let hireRecord = null;
    if (createHireRecord) {
      try {
        const hirerDoc = await KycCardUser.findOne({ uid: engagerId }).lean();
        const workerDoc = await KycCardUser.findOne({ uid: userId }).lean();

        const hirePayload = {
          hirerUid: String(engagerId),
          workerUid: String(userId),
          status: "completed",
          startedAt: capturedEngagedAt,
          endedAt: new Date(),
          payment: Number(payment || 0),
          notes: notes || `Released by ${engagerId}`,
          metadata: metadata || {},
          workId: capturedWorkId,
        };

        if (hirerDoc && hirerDoc._id) hirePayload.hirerId = hirerDoc._id;
        if (workerDoc && workerDoc._id) hirePayload.workerId = workerDoc._id;

        const created = await Hire.create(hirePayload);
        hireRecord = await Hire.findById(created._id)
          .populate({ path: "workerId", select: "uid fullName mobile gender age" })
          .lean();
      } catch (hireErr) {
        console.error("ENGAGE.RELEASE: failed to create hire record:", hireErr);
        return res.json({ isSuccess: true, data: { status: "free" }, warning: "HIRE_CREATE_FAILED" });
      }
    }

    return res.json({ isSuccess: true, data: { status: "free", hire: hireRecord, workId: capturedWorkId } });
  } catch (e) {
    console.error("ENGAGE.RELEASE error:", e);
    return res.status(500).json({ isSuccess: false, error: "RELEASE_ERROR", errorDetail: e.message });
  }
});

export default router;
