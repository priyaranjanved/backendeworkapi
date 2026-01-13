// app.js
import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";

import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ----- Existing routes -----
import userRoutes from "./routes/userRoutes.js";
import aadhaarRoutes from "./routes/aadhaarRoutes.js";
import workRoutes from "./routes/workRoutes.js";
import jobRoutes from "./routes/job.routes.js";
import engageRoutes from "./routes/engage.routes.js";
import hireRoutes from "./routes/hireRoutes.js";
import appConfigRoutes from "./routes/appConfig.routes.js";
import businessRoutes from "./routes/businessRoutes.js";

// ✅ KYC routes
import kycUserRoutes from "./routes/kycUser.routes.js";

const app = express();

// ✅ VERY IMPORTANT for Render / Proxy (so req.protocol becomes https)
app.set("trust proxy", 1);

/* 🔹 GLOBAL REQUEST LOGGER (ONLY ONCE) */
app.use((req, _res, next) => {
  console.log(">>>", req.method, req.originalUrl, "from", req.ip);
  next();
});

// ----- Core middleware -----
const allow = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({ origin: allow.length ? allow : true, credentials: true }));
app.use(helmet());

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(morgan("dev"));

// ----- Health check -----
app.get("/health", (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get("/", (_req, res) => res.json({ message: "Welcome to E-Rojgar API 🚀" }));

// ✅ uploads folder (same as multer/controller: process.cwd()/uploads)
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.join(process.cwd(), "uploads");

// ✅ ensure folder exists
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ✅ Serve uploads (KEEP THIS BEFORE 404)
app.use("/uploads", express.static(uploadsDir));

app.get("/debug-uploads", (req, res) => {
  try {
    const files = fs.existsSync(uploadsDir) ? fs.readdirSync(uploadsDir) : [];
    res.json({
      uploadsDir,
      exists: fs.existsSync(uploadsDir),
      count: files.length,
      files: files.slice(0, 50),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ----- API Routes -----
app.use("/api/app", appConfigRoutes);

app.use("/api/user", userRoutes);
app.use("/api/works", workRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/aadhaar", aadhaarRoutes);

app.use("/api/business", businessRoutes);
app.use("/api", hireRoutes);
app.use("/api/engage", engageRoutes);

// ✅ mount KYC routes
app.use("/api/kyc", kycUserRoutes);

// ----- 404 (LAST) -----
app.use((req, res) => {
  return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
});

export default app;
