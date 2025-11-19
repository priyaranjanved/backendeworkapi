import express from "express";
import { verifyAadhaar, loginWithAadhaar, insertBulkAadhaar } from "../controllers/aadhaarController.js";

const router = express.Router();

router.post("/verify", verifyAadhaar);       // POST /api/aadhaar/verify
router.post("/login", loginWithAadhaar);     // POST /api/aadhaar/login
router.post("/bulk-insert", insertBulkAadhaar); // POST /api/aadhaar/bulk-insert

export default router;
