// routes/busyRoutes.js
import express from "express";
import * as BusyCtrl from "../controllers/busyController.js";
const router = express.Router();

// allocate busy: body { targetUid, byUid, hours } (hours can be fractional)
router.post("/allocate", BusyCtrl.allocate);

// release busy (by record id)
router.post("/release", BusyCtrl.release);

// get status for a user
router.get("/status/:uid", BusyCtrl.status);

// manual enable (user requests to allow busy allocations again) - only allowed if nextEnableAt passed
router.post("/enable", BusyCtrl.manualEnable);

export default router;
