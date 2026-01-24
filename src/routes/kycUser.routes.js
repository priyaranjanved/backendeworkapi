// src/routes/kycUser.routes.js
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
  getKycUserByUidProfile,
  getUserByUid,
   activatePremiumOneYear,
  checkPremiumExpire,
  getPlanStatusByUid,
} from "../controllers/kycUser.controller.js";

const router = express.Router();

/** ✅ uploads folder (MUST MATCH app.js uploadsDir) */
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

/**
 * ✅ Multer config
 * IMPORTANT:
 * - controller uses req.file.buffer (sharp compression)
 * - so we MUST use memoryStorage() (not diskStorage)
 * - size limit: 5MB input (after compression ~1-3MB output)
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB input max
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype?.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
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
router.post("/user", express.json(), createKycUser);

// ✅ Get by UID
router.get("/user/uid/:uid", getKycUserByUid);
// ✅ Get by UID
router.get("/user/uidprofile/:uid", getKycUserByUidProfile);

router.get("user/byUid/:uid", getUserByUid);


router.post("/user/activate-premium/:uid", activatePremiumOneYear);
router.post("/user/check-premium/:uid", checkPremiumExpire);
router.get("/user/plan/:uid", getPlanStatusByUid);
// ✅ Upsert by UID (create or update)
router.post("/user/uid/:uid", express.json(), upsertKycUserByUid);

export default router;
