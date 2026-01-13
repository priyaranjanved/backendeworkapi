import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";

import {
  registerKycUser,
  getKycUser,
  updatePlanType,
  updateFacePhoto,
  createKycUser,
  getKycUserByUid,
  upsertKycUserByUid,
} from "../controllers/kycUser.controller.js";

const router = express.Router();

/** ✅ uploads folder (MUST MATCH app.js uploadsDir) */
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

function fileFilter(_req, file, cb) {
  if (!file.mimetype?.startsWith("image/")) return cb(new Error("Only image files allowed"));
  cb(null, true);
}

/** ✅ multer config (UPDATED)
 * - memoryStorage: file RAM me aayegi => controller sharp se compress karega
 * - limits: input 10MB (camera raw bada aa sakta hai, output compress hoga)
 */
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB input max
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
