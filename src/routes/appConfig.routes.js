import express from "express";
import { getMapIcons, upsertMapIcons } from "../controllers/appConfig.controller.js";

const router = express.Router();

// GET → Fetch icons for map markers
router.get("/map-icons", getMapIcons);

// POST → Insert or Update icons
router.post("/map-icons", upsertMapIcons);

export default router;
