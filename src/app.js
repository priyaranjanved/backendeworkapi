// app.js
import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";
import path from "path";

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

// ✅ Business Route file
import businessRoutes from "./routes/businessRoutes.js";

const app = express();

/* 🔹 GLOBAL REQUEST LOGGER
   -> sabse upar rakha hai, taaki har request dikh jaaye
*/
app.use((req, res, next) => {
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

// 🔹 Body size limit badha diya (images ke liye)
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.use(morgan("dev"));

// ----- Health check -----
app.get("/health", (req, res) =>
  res.json({ ok: true, uptime: process.uptime() })
);

app.get("/", (req, res) =>
  res.json({ message: "Welcome to E-Rojgar API 🚀" })
);

// ----- API Routes -----
app.use("/api/user", userRoutes);
app.use("/api/works", workRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/aadhaar", aadhaarRoutes);

// ✅ Business API
app.use("/api/business", businessRoutes);

// Hire routes
app.use("/api", hireRoutes);

// ----- Serve uploads -----
app.use("/uploads", express.static(path.join(__dirname, "src", "uploads")));

// ----- Engage -----
app.use("/api/engage", engageRoutes);

// ----- 404 -----
app.use((req, res) => {
  return res
    .status(404)
    .json({ isSuccess: false, error: "NOT_FOUND" });
});
app.use((req, res, next) => {
  console.log(">>>", req.method, req.originalUrl, "from", req.ip);
  next();
});

export default app;
