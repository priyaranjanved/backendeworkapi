// routes/hire.js
import express from "express";
import mongoose from "mongoose";
import KycCardUser from "../models/KycCardUser.js"; // ✅ CHANGED (User -> KycCardUser)
import Hire from "../models/hire.model.js";

const router = express.Router();

/**
 * POST /hire
 * body: { hirerUid, workerUid, payment=0, notes="" }
 * (Mounted as /api/hire when app.use("/api", hireRoutes) is used)
 */
router.post("/hire", async (req, res) => {
  try {
    const { hirerUid, workerUid, payment = 0, notes = "" } = req.body;
    console.log("POST /api/hire body:", req.body);

    if (!hirerUid || !workerUid) {
      return res.status(400).json({ isSuccess: false, error: "hirerUid and workerUid required" });
    }

    // best-effort find user docs
    const hirer = await KycCardUser.findOne({ uid: hirerUid }).lean().catch(() => null);
    const worker = await KycCardUser.findOne({ uid: workerUid }).lean().catch(() => null);

    const payload = {
      hirerUid: String(hirerUid),
      workerUid: String(workerUid),
      payment: typeof payment === "number" ? payment : Number(payment || 0),
      notes: notes || "",
      status: "completed",
      startedAt: new Date(),
      endedAt: new Date(),
      metadata: {}
    };

    if (hirer && hirer._id) payload.hirerId = hirer._id;
    if (worker && worker._id) payload.workerId = worker._id;

    const created = await Hire.create(payload);

    // NOTE: populate will work only if Hire schema refs point to KycCardUser.
    // If Hire schema still refs "User", then below populate won't resolve (still safe).
    const populated = await Hire.findById(created._id)
      .populate({ path: "workerId", select: "uid fullName mobile gender age planType facePhoto" }) // ✅ CHANGED fields
      .lean();

    console.log("POST /api/hire created id=", created._id);
    return res.json({ isSuccess: true, data: populated });
  } catch (err) {
    console.error("POST /api/hire error:", err);
    if (err && err.name === "ValidationError") {
      return res.status(400).json({ isSuccess: false, error: "VALIDATION_ERROR", details: err.errors });
    }
    return res.status(500).json({ isSuccess: false, error: "Server error", detail: err?.message || String(err) });
  }
});

/**
 * GET /user/byUid/:uid/hired
 * Returns hires where hirerId == user._id OR hirerUid == uid
 * (Mounted as /api/user/byUid/:uid/hired)
 */
// router.get("/user/byUid/:uid/hired", async (req, res) => {
//   try {
//     let { uid } = req.params;
//     uid = String(uid || "").trim();
//     console.log("GET /api/user/byUid/:uid/hired -> uid:", uid);

//     // find user doc if possible (but even if not found we can still search hires by uid)
//     let user = await User.findOne({ uid }).select("_id uid name").lean();
//     if (!user && mongoose.Types.ObjectId.isValid(uid)) {
//       user = await User.findById(uid).select("_id uid name").lean();
//     }
//     if (!user) {
//       user = await User.findOne({ aadhaar: uid }).select("_id uid name").lean();
//     }

//     const orClauses = [];
//     if (user && user._id) {
//       orClauses.push({ hirerId: user._id });
//     }
//     orClauses.push({ hirerUid: uid });

//     const hires = await Hire.find({ $or: orClauses }).sort({ createdAt: -1 }).lean();

//     // lookup worker user docs if hire.workerId available
//     const workerIds = hires.map(h => h.workerId).filter(Boolean);
//     let workersById = {};
//     if (workerIds.length > 0) {
//       const workers = await User.find({ _id: { $in: workerIds } }).select("uid name mobile aadhaar gender age").lean();
//       workersById = workers.reduce((acc, w) => { acc[String(w._id)] = w; return acc; }, {});
//     }

//     const data = hires.map(h => {
//       const workerInfo = (h.workerId && workersById[String(h.workerId)]) || null;
//       const workerFallback = workerInfo || {
//         uid: h.workerUid || "—",
//         name: workerInfo?.name || "Unknown",
//         mobile: workerInfo?.mobile || "—",
//         aadhaar: workerInfo?.aadhaar || h.workerUid || "—",
//         gender: workerInfo?.gender || null,
//         age: workerInfo?.age ?? null
//       };

//       return {
//         _id: h._id,
//         worker: workerFallback,
//         startedAt: h.startedAt,
//         endedAt: h.endedAt,
//         payment: h.payment,
//         notes: h.notes,
//         status: h.status,
//         createdAt: h.createdAt
//       };
//     });

//     return res.json({ isSuccess: true, data });
//   } catch (err) {
//     console.error("GET /api/user/byUid/:uid/hired error:", err);
//     return res.status(500).json({ isSuccess: false, error: "Server error", detail: err?.message || String(err) });
//   }
// });


// GET /user/byUid/:uid/hired
router.get("/user/byUid/:uid/hired", async (req, res) => {
  try {
    let { uid } = req.params;
    uid = String(uid || "").trim();
    const role = String(req.query.role || "").toLowerCase(); // '', 'worker', 'both', 'hirer'

    if (!uid) return res.status(400).json({ isSuccess: false, error: "MISSING_UID" });
    console.log("GET /api/user/byUid/:uid/hired -> uid:", uid, "role:", role);

    // try find user doc if possible
    let user = await KycCardUser.findOne({ uid }).select("_id uid fullName").lean();
    if (!user && mongoose.Types.ObjectId.isValid(uid)) {
      user = await KycCardUser.findById(uid).select("_id uid fullName").lean();
    }

    // NOTE: aadhaar wala fallback ab nahi hai (kyunki KycCardUser schema me aadhaar field nahi hai)
    // if (!user) {
    //   user = await User.findOne({ aadhaar: uid }).select("_id uid name").lean();
    // }

    // build search clauses based on role
    const orClauses = [];
    if (role === "worker") {
      if (user && user._id) orClauses.push({ workerId: user._id });
      orClauses.push({ workerUid: uid });
    } else if (role === "both") {
      if (user && user._id) {
        orClauses.push({ hirerId: user._id }, { workerId: user._id });
      }
      orClauses.push({ hirerUid: uid }, { workerUid: uid });
    } else {
      // default: hirer
      if (user && user._id) orClauses.push({ hirerId: user._id });
      orClauses.push({ hirerUid: uid });
    }

    const hires = await Hire.find({ $or: orClauses }).sort({ createdAt: -1 }).lean();

    // lookup other party user docs if available (we'll try to populate the other side)
    const otherIds = [];
    if (role === "worker") {
      otherIds.push(...hires.map(h => h.hirerId).filter(Boolean));
    } else {
      otherIds.push(...hires.map(h => h.workerId).filter(Boolean));
    }

    let othersById = {};
    if (otherIds.length > 0) {
      const others = await KycCardUser.find({ _id: { $in: otherIds } })
        .select("uid fullName mobile gender age planType facePhoto")
        .lean();

      othersById = others.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});
    }

    const data = hires.map(h => {
      if (role === "worker") {
        const hirerInfo =
          (h.hirerId && othersById[String(h.hirerId)]) ||
          (h.hirerUid ? { uid: h.hirerUid, fullName: h.hirerUid, mobile: null } : null);

        return {
          _id: h._id,
          hirer: hirerInfo
            ? {
                uid: hirerInfo.uid || h.hirerUid || "—",
                fullName: hirerInfo.fullName || hirerInfo.uid || "Unknown",
                mobile: hirerInfo.mobile || "—",
                gender: hirerInfo.gender || null,
                age: hirerInfo.age ?? null,
                planType: hirerInfo.planType || null,
                facePhoto: hirerInfo.facePhoto || null,
              }
            : null,
          startedAt: h.startedAt,
          endedAt: h.endedAt,
          payment: h.payment,
          notes: h.notes,
          status: h.status,
          createdAt: h.createdAt,
          metadata: h.metadata || {}
        };
      } else {
        const workerInfo = (h.workerId && othersById[String(h.workerId)]) || null;

        const workerFallback = workerInfo || {
          uid: h.workerUid || "—",
          fullName: workerInfo?.fullName || "Unknown",
          mobile: workerInfo?.mobile || "—",
          gender: workerInfo?.gender || null,
          age: workerInfo?.age ?? null,
          planType: workerInfo?.planType || null,
          facePhoto: workerInfo?.facePhoto || null,
        };

        return {
          _id: h._id,
          worker: {
            uid: workerFallback.uid || "—",
            fullName: workerFallback.fullName || "Unknown",
            mobile: workerFallback.mobile || "—",
            gender: workerFallback.gender || null,
            age: workerFallback.age ?? null,
            planType: workerFallback.planType || null,
            facePhoto: workerFallback.facePhoto || null,
          },
          startedAt: h.startedAt,
          endedAt: h.endedAt,
          payment: h.payment,
          notes: h.notes,
          status: h.status,
          createdAt: h.createdAt,
          metadata: h.metadata || {}
        };
      }
    });

    return res.json({ isSuccess: true, data });
  } catch (err) {
    console.error("GET /api/user/byUid/:uid/hired error:", err);
    return res.status(500).json({ isSuccess: false, error: "Server error", detail: err?.message || String(err) });
  }
});

export default router;
