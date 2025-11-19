// ./routes/user.routes.js
import { Router } from "express";
// NOTE: adjust path if your model file name/path differs.
// The model file created earlier was named user.model.js
import User from "../models/user.js";

const router = Router();

function makeUid() {
  return `USR-${Date.now()}-${Math.floor(Math.random() * 9000 + 1000)}`;
}

function normalizeAadhaar(a) {
  if (!a) return "";
  return String(a).replace(/\D/g, "").trim();
}

// POST /api/user/register
// body: { aadhaar, name, mobile, age?, gender?, planType? }
router.post("/register", async (req, res) => {
  try {
    const rawAadhaar = req.body?.aadhaar ?? "";
    const aadhaar = normalizeAadhaar(rawAadhaar);
    if (!aadhaar || aadhaar.length < 10) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_AADHAAR" });
    }

    const name = req.body?.name ?? "";
    const mobile = req.body?.mobile ?? "";
    const age = Number.isFinite(Number(req.body?.age)) ? Number(req.body.age) : null;
    const gender = req.body?.gender ? String(req.body.gender) : null;
    const planType = req.body?.planType && ["Basic", "Premium"].includes(req.body.planType)
      ? req.body.planType
      : "Basic";

    // If user with same aadhaar exists, return existing full user doc (idempotent)
    let existing = await User.findOne({ aadhaar });
    if (existing) {
      // If an existing user is Basic but request asked for Premium, optionally upgrade now:
      if (planType === "Premium" && existing.planType !== "Premium") {
        // activate insurance & upgrade
        await existing.activateInsurance();
        existing = await User.findOne({ aadhaar }).lean();
        return res.json({ isSuccess: true, data: existing });
      }
      return res.json({ isSuccess: true, data: existing.toObject ? existing.toObject() : existing });
    }

    // create new uid and save (store normalized aadhaar and extra fields)
    const uid = makeUid();
    const createObj = {
      uid,
      aadhaar,
      name: name || "",
      mobile: mobile || "",
      age,
      gender,
      planType
    };

    // create user
    let user = await User.create(createObj);

    // If they selected Premium at registration, activate 1-year insurance
    if (planType === "Premium") {
      // `activateInsurance` is an instance method — reload user doc as a model instance
      user = await User.findById(user._id);
      await user.activateInsurance();
      user = await User.findById(user._id).lean();
    } else {
      // ensure returned object is plain JSON
      user = user.toObject ? user.toObject() : user;
    }

    return res.json({ isSuccess: true, data: user });
  } catch (e) {
    console.error("USER REGISTER ERR", e);
    if (e?.code === 11000) {
      return res.status(500).json({ isSuccess: false, error: "UID_COLLISION" });
    }
    res.status(500).json({ isSuccess: false, error: "REGISTER_ERROR" });
  }
});

/**
 * POST /api/user/activate-insurance/:uid
 * - Activate or renew insurance for 1 year from now.
 * - Accepts uid (USR-...), Mongo _id, or aadhaar in :uid param.
 * - Returns updated user document.
 */
router.post("/activate-insurance/:uid", async (req, res) => {
  try {
    const raw = req.params.uid ?? "";
    const cleaned = String(raw).trim();
    if (!cleaned) return res.status(400).json({ isSuccess: false, error: "MISSING_UID" });

    // find user by uid / _id / aadhaar
    let user = await User.findOne({ uid: cleaned });
    if (!user && /^[0-9a-fA-F]{24}$/.test(cleaned)) {
      user = await User.findById(cleaned);
    }
    if (!user && /^\d{10,12}$/.test(cleaned)) {
      user = await User.findOne({ aadhaar: cleaned });
    }
    if (!user) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    // activate/renew insurance (also sets planType to Premium)
    await user.activateInsurance();
    const updated = await User.findById(user._id).lean();
    return res.json({ isSuccess: true, data: updated });
  } catch (err) {
    console.error("[user.routes] activate-insurance error:", err);
    return res.status(500).json({ isSuccess: false, error: "ACTIVATE_INSURANCE_ERROR" });
  }
});

/**
 * POST /api/user/check-expire/:uid
 * - Manually check if user's insurance expired and expire it (optionally downgrades to Basic).
 * - Body optional { downgradeToBasic: true|false } (default true)
 */
router.post("/check-expire/:uid", async (req, res) => {
  try {
    const raw = req.params.uid ?? "";
    const cleaned = String(raw).trim();
    if (!cleaned) return res.status(400).json({ isSuccess: false, error: "MISSING_UID" });

    let user = await User.findOne({ uid: cleaned });
    if (!user && /^[0-9a-fA-F]{24}$/.test(cleaned)) {
      user = await User.findById(cleaned);
    }
    if (!user && /^\d{10,12}$/.test(cleaned)) {
      user = await User.findOne({ aadhaar: cleaned });
    }
    if (!user) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    const downgrade = typeof req.body?.downgradeToBasic === "boolean" ? req.body.downgradeToBasic : true;
    const expired = await user.checkAndExpireInsurance(downgrade);
    const updated = await User.findById(user._id).lean();
    return res.json({ isSuccess: true, data: { user: updated, expired } });
  } catch (err) {
    console.error("[user.routes] check-expire error:", err);
    return res.status(500).json({ isSuccess: false, error: "CHECK_EXPIRE_ERROR" });
  }
});

/**
 * GET /api/user/byUid/:uid
 * - robust lookup for a single user document
 * - tries: uid, _id (ObjectId), aadhaar
 */
router.get("/byUid/:uid", async (req, res) => {
  try {
    const raw = req.params.uid ?? "";
    let decoded;
    try { decoded = decodeURIComponent(raw); } catch (e) { decoded = raw; }
    const cleaned = (decoded || "").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim();

    if (!cleaned) return res.status(400).json({ isSuccess: false, error: "MISSING_UID" });

    // exact uid
    let user = await User.findOne({ uid: cleaned }).lean();
    if (user) return res.json({ isSuccess: true, data: user });

    // objectId
    if (/^[0-9a-fA-F]{24}$/.test(cleaned)) {
      user = await User.findById(cleaned).lean();
      if (user) return res.json({ isSuccess: true, data: user });
    }

    // numeric aadhaar
    if (/^\d{10,12}$/.test(cleaned)) {
      user = await User.findOne({ aadhaar: cleaned }).lean();
      if (user) return res.json({ isSuccess: true, data: user });
    }

    return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
  } catch (err) {
    console.error("[user.routes] /byUid error:", err);
    return res.status(500).json({ isSuccess: false, error: "USER_ERROR" });
  }
});

// GET /api/user/all  -- DEBUG ONLY
router.get("/all", async (req, res) => {
  try {
    const users = await User.find({}).limit(200).lean();
    res.json({ isSuccess: true, data: users });
  } catch (e) {
    console.error(e);
    res.status(500).json({ isSuccess: false, error: "USER_LIST_ERROR" });
  }
});

export default router;
