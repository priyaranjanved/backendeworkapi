import KycCardUser from "../models/KycCardUser.js";
import sharp from "sharp";
import path from "path";
import fs from "fs";

const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function makeUid() {
  return `USR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function parseDob(dobStr) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * ✅ Save compressed face photo + also return base64
 * Target: practical 1–3MB
 * - resize max 1600px
 * - quality 88 (mostly)
 * - if >3MB then quality 82
 *
 * Returns:
 * { filename, size, data }  // data = data:image/jpeg;base64,...
 */
async function saveCompressedFace(buffer) {
  const filename = `face_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}.jpg`;
  const outPath = path.join(uploadsDir, filename);

  const base = sharp(buffer)
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true });

  // 1) first try
  await base.jpeg({ quality: 88, mozjpeg: true }).toFile(outPath);
  let outBuffer = fs.readFileSync(outPath);
  let size = outBuffer.length;

  // 2) if too big, compress more
  if (size > 3 * 1024 * 1024) {
    await base.jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);
    outBuffer = fs.readFileSync(outPath);
    size = outBuffer.length;
  }

  const data = `data:image/jpeg;base64,${outBuffer.toString("base64")}`;

  return { filename, size, data };
}

// ✅ REGISTER
export const registerKycUser = async (req, res) => {
  try {
    const { fullName, mobile, dob, age, gender, planType } = req.body;

    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({ ok: false, error: "fullName required" });
    }
    if (!mobile || !/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ ok: false, error: "mobile must be 10 digits" });
    }

    const dobDate = parseDob(dob);
    if (!dobDate) return res.status(400).json({ ok: false, error: "dob invalid" });

    const ageNum = Number(age);
    if (!Number.isFinite(ageNum) || ageNum < 0 || ageNum > 120) {
      return res.status(400).json({ ok: false, error: "age invalid" });
    }

    if (!["male", "female", "other"].includes(gender)) {
      return res.status(400).json({ ok: false, error: "gender invalid" });
    }

    if (!req.file) {
      return res.status(400).json({ ok: false, error: "photo file required (field: photo)" });
    }

    // duplicate check by mobile
    const existing = await KycCardUser.findOne({ mobile }).lean();
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: "mobile already registered",
        uid: existing.uid,
        user: {
          uid: existing.uid,
          fullName: existing.fullName,
          mobile: existing.mobile,
          dob: existing.dob,
          age: existing.age,
          gender: existing.gender,
          planType: existing.planType,
          facePhotoUrl: existing.facePhoto?.url || null,
        },
      });
    }

    const uid = makeUid();
    const baseUrl = process.env.BASE_URL || `https://${req.get("host")}`;

    // ✅ COMPRESS + SAVE + BASE64
    const { filename, size, data } = await saveCompressedFace(req.file.buffer);
    const photoUrl = `${baseUrl}/uploads/${filename}`;

    const user = await KycCardUser.create({
      uid,
      fullName: fullName.trim(),
      mobile,
      dob: dobDate,
      age: ageNum,
      gender,
      planType: planType && ["Basic", "Premium"].includes(planType) ? planType : "Basic",
      facePhoto: {
        fileName: filename,
        mimeType: "image/jpeg",
        size: size,
        url: photoUrl, // ✅ keep url as you want
        data: data,    // ✅ NEW: permanent base64 (business style)
      },
    });

    return res.json({
      ok: true,
      uid: user.uid,
      planType: user.planType,
      user: {
        uid: user.uid,
        fullName: user.fullName,
        mobile: user.mobile,
        dob: user.dob,
        age: user.age,
        gender: user.gender,
        planType: user.planType,
        facePhotoUrl: user.facePhoto.url,
        facePhotoData: user.facePhoto.data, // optional (debug)
      },
    });
  } catch (err) {
    console.error("registerKycUser error:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};

// ✅ GET USER (login time)
export const getKycUser = async (req, res) => {
  try {
    const { mobile, uid } = req.query;

    if (!mobile && !uid) {
      return res.status(400).json({ ok: false, error: "send mobile or uid" });
    }

    const user = uid
      ? await KycCardUser.findOne({ uid }).lean()
      : await KycCardUser.findOne({ mobile }).lean();

    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    return res.json({
      ok: true,
      user: {
        uid: user.uid,
        fullName: user.fullName,
        mobile: user.mobile,
        dob: user.dob,
        age: user.age,
        gender: user.gender,
        planType: user.planType,
        facePhotoUrl: user.facePhoto?.url || null,
        facePhotoData: user.facePhoto?.data || null, // ✅ NEW (optional)
      },
    });
  } catch (err) {
    console.error("getKycUser error:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};

// ✅ UPDATE PLAN
export const updatePlanType = async (req, res) => {
  try {
    const { uid, planType } = req.body;

    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });
    if (!["Basic", "Premium"].includes(planType)) {
      return res.status(400).json({ ok: false, error: "planType must be Basic or Premium" });
    }

    const user = await KycCardUser.findOneAndUpdate(
      { uid },
      { $set: { planType } },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    return res.json({ ok: true, uid: user.uid, planType: user.planType });
  } catch (err) {
    console.error("updatePlanType error:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};

/**
 * POST /kyc
 * Create new KYC user (uid required)
 */
export const createKycUser = async (req, res) => {
  try {
    const { uid, fullName, mobile, dob, age, gender, planType, facePhoto } = req.body;

    if (!uid) return res.status(400).json({ message: "uid is required" });
    if (!fullName) return res.status(400).json({ message: "fullName is required" });
    if (!mobile) return res.status(400).json({ message: "mobile is required" });
    if (!dob) return res.status(400).json({ message: "dob is required" });
    if (age === undefined || age === null) return res.status(400).json({ message: "age is required" });
    if (!gender) return res.status(400).json({ message: "gender is required" });
    if (!facePhoto) return res.status(400).json({ message: "facePhoto is required" });

    // Prevent duplicate by uid or mobile
    const existing = await KycCardUser.findOne({ $or: [{ uid }, { mobile }] });
    if (existing) {
      return res.status(409).json({
        message: "User already exists with same uid or mobile",
        data: existing,
      });
    }

    const doc = await KycCardUser.create({
      uid,
      fullName,
      mobile,
      dob: new Date(dob),
      age,
      gender,
      planType: planType || "Basic",
      facePhoto,
    });

    return res.status(201).json({ message: "KYC user created", data: doc });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate uid/mobile", error: err.keyValue });
    }
    return res.status(500).json({ message: "Server error", error: err?.message || err });
  }
};

/**
 * GET /kyc/uid/:uid
 * Fetch KYC user by uid
 */
export const getKycUserByUid = async (req, res) => {
  try {
    const raw = req.params.uid ?? "";
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}

    const cleaned = String(decoded)
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      .trim();

    if (!cleaned) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_UID" });
    }

    const user = await KycCardUser.findOne({ uid: cleaned }).lean();

    if (!user) {
      return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
    }

    return res.status(200).json({ isSuccess: true, data: user });
  } catch (err) {
    console.error("getKycUserByUid error:", err);
    return res.status(500).json({ isSuccess: false, error: "SERVER_ERROR" });
  }
};

/**
 * POST /kyc/uid/:uid
 * Upsert by uid (if exists -> update, else -> create)
 */
export const upsertKycUserByUid = async (req, res) => {
  try {
    const { uid } = req.params;

    if (!uid) return res.status(400).json({ message: "uid param is required" });

    const payload = { ...req.body, uid };
    if (payload.dob) payload.dob = new Date(payload.dob);

    const updated = await KycCardUser.findOneAndUpdate(
      { uid },
      { $set: payload },
      { new: true, upsert: true, runValidators: true }
    );

    return res.status(200).json({ message: "KYC user upserted by uid", data: updated });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({ message: "Duplicate uid/mobile", error: err.keyValue });
    }
    return res.status(500).json({ message: "Server error", error: err?.message || err });
  }
};

// ✅ UPDATE PHOTO (compressed + base64)
export const updateFacePhoto = async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });
    if (!req.file) return res.status(400).json({ ok: false, error: "photo file required (field: photo)" });

    const baseUrl = process.env.BASE_URL || `https://${req.get("host")}`;

    // ✅ COMPRESS + SAVE + BASE64
    const { filename, size, data } = await saveCompressedFace(req.file.buffer);
    const photoUrl = `${baseUrl}/uploads/${filename}`;

    const user = await KycCardUser.findOneAndUpdate(
      { uid },
      {
        $set: {
          facePhoto: {
            fileName: filename,
            mimeType: "image/jpeg",
            size: size,
            url: photoUrl,
            data: data,
          },
        },
      },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    return res.json({
      ok: true,
      uid: user.uid,
      facePhotoUrl: user.facePhoto.url,
      facePhotoData: user.facePhoto.data, // optional (debug)
    });
  } catch (err) {
    console.error("updateFacePhoto error:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};
