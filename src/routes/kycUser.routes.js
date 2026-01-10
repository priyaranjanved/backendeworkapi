import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";

import {
  registerKycUser,
  getKycUser,
  updatePlanType,
  updateFacePhoto,
  createKycUser, getKycUserByUid, upsertKycUserByUid 
} from "../controllers/kycUser.controller.js";

const router = express.Router();

/** ✅ uploads folder (project root /uploads) */
/** ✅ uploads folder (MUST MATCH app.js uploadsDir) */
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });


/** ✅ multer config */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    const safe = `face_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}${ext}`;
    cb(null, safe);
  },
});

function fileFilter(_req, file, cb) {
  if (!file.mimetype.startsWith("image/")) return cb(new Error("Only image files allowed"));
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// ✅ routes
router.post("/register", upload.single("photo"), registerKycUser);
router.get("/user", getKycUser);
router.patch("/plan", express.json(), updatePlanType);
router.patch("/photo", upload.single("photo"), updateFacePhoto);

/** -------------------------
 * ✅ NEW UID Routes
 * base: /api/kyc
 * ------------------------*/

// ✅ (Optional) Create KYC using JSON body (uid required)
router.post("/user", createKycUser);

// ✅ Get by UID
router.get("/user/uid/:uid", getKycUserByUid);

// ✅ Upsert by UID (create or update)
router.post("/user/uid/:uid", upsertKycUserByUid);


export default router;
