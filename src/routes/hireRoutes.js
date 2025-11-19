// routes/hire.js
import express from "express";
import mongoose from "mongoose";
import User from "../models/user.js";
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
    const hirer = await User.findOne({ uid: hirerUid }).lean().catch(() => null);
    const worker = await User.findOne({ uid: workerUid }).lean().catch(() => null);

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
    const populated = await Hire.findById(created._id)
      .populate({ path: "workerId", select: "uid name mobile aadhaar gender age" })
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
    let user = await User.findOne({ uid }).select("_id uid name").lean();
    if (!user && mongoose.Types.ObjectId.isValid(uid)) {
      user = await User.findById(uid).select("_id uid name").lean();
    }
    if (!user) {
      user = await User.findOne({ aadhaar: uid }).select("_id uid name").lean();
    }

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
      // need to show hirer info
      otherIds.push(...hires.map(h => h.hirerId).filter(Boolean));
    } else {
      // default hirer view already finds workers; keep existing behavior
      otherIds.push(...hires.map(h => h.workerId).filter(Boolean));
    }

    let othersById = {};
    if (otherIds.length > 0) {
      const others = await User.find({ _id: { $in: otherIds } }).select("uid name mobile aadhaar gender age").lean();
      othersById = others.reduce((acc, u) => { acc[String(u._id)] = u; return acc; }, {});
    }

    const data = hires.map(h => {
      // build the item depending on role
      if (role === "worker") {
        // show hirer as the "other" party
        const hirerInfo = (h.hirerId && othersById[String(h.hirerId)]) || (h.hirerUid ? { uid: h.hirerUid, name: h.hirerUid, mobile: null } : null);
        return {
          _id: h._id,
          hirer: hirerInfo,
          startedAt: h.startedAt,
          endedAt: h.endedAt,
          payment: h.payment,
          notes: h.notes,
          status: h.status,
          createdAt: h.createdAt,
          metadata: h.metadata || {}
        };
      } else {
        // default: existing worker-focused response
        const workerInfo = (h.workerId && othersById[String(h.workerId)]) || null;
        const workerFallback = workerInfo || {
          uid: h.workerUid || "—",
          name: workerInfo?.name || "Unknown",
          mobile: workerInfo?.mobile || "—",
          aadhaar: workerInfo?.aadhaar || h.workerUid || "—",
          gender: workerInfo?.gender || null,
          age: workerInfo?.age ?? null
        };

        return {
          _id: h._id,
          worker: workerFallback,
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
