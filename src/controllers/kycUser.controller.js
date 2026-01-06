import KycCardUser from "../models/KycCardUser.js";

function makeUid() {
  return `USR-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

function parseDob(dobStr) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  return d;
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
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const photoUrl = `${baseUrl}/uploads/${req.file.filename}`;

    const user = await KycCardUser.create({
      uid,
      fullName: fullName.trim(),
      mobile,
      dob: dobDate,
      age: ageNum,
      gender,
      planType: planType && ["Basic", "Premium"].includes(planType) ? planType : "Basic",
      facePhoto: {
        fileName: req.file.filename,
        mimeType: req.file.mimetype,
        size: req.file.size,
        url: photoUrl,
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

// ✅ UPDATE PHOTO
export const updateFacePhoto = async (req, res) => {
  try {
    const { uid } = req.body;

    if (!uid) return res.status(400).json({ ok: false, error: "uid required" });
    if (!req.file) return res.status(400).json({ ok: false, error: "photo file required (field: photo)" });

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get("host")}`;
    const photoUrl = `${baseUrl}/uploads/${req.file.filename}`;

    const user = await KycCardUser.findOneAndUpdate(
      { uid },
      {
        $set: {
          facePhoto: {
            fileName: req.file.filename,
            mimeType: req.file.mimetype,
            size: req.file.size,
            url: photoUrl,
          },
        },
      },
      { new: true }
    ).lean();

    if (!user) return res.status(404).json({ ok: false, error: "user not found" });

    return res.json({ ok: true, uid: user.uid, facePhotoUrl: user.facePhoto.url });
  } catch (err) {
    console.error("updateFacePhoto error:", err);
    return res.status(500).json({ ok: false, error: "server error" });
  }
};
