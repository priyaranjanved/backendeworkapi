// app.js
import express from "express";
import morgan from "morgan";
import cors from "cors";
import helmet from "helmet";

// Your existing routes (ensure paths are correct)
import userRoutes from "./routes/userRoutes.js";
import aadhaarRoutes from "./routes/aadhaarRoutes.js";
import workRoutes from "./routes/workRoutes.js";
import jobRoutes from "./routes/job.routes.js";
import engageRoutes from "./routes/engage.routes.js";
import hireRoutes from "./routes/hireRoutes.js";

// ✅ NEW: Business routes import
import businessRoutes from "./routes/businessRoutes.js";

const app = express();

// ----- Core middleware -----
const allow = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use(cors({ origin: allow.length ? allow : true, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

// ----- Health check & default route -----
app.get("/health", (req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.get("/", (req, res) => res.json({ message: "Welcome to E-Rojgar API 🚀" }));

// ----- API routes (mount them BEFORE 404) -----
// IMPORTANT: frontend expects /api/user/register (singular "user")
app.use("/api/user", userRoutes);      // <--- singular, matches frontend
app.use("/api/works", workRoutes);
app.use("/api/jobs", jobRoutes);
app.use("/api/aadhaar", aadhaarRoutes);
// hireRoutes uses relative paths (/hire and /user/byUid/:uid/hired) -> mounted under /api
app.use("/api", hireRoutes);

// engage endpoints under /api/engage
app.use("/api/engage", engageRoutes);

// ✅ NEW: mount Business routes
// Base path chosen as /api/business (matches routes file)
// If you prefer plural, change to: app.use("/api/businesses", businessRoutes)
app.use("/api/business", businessRoutes);

// ----- 404 (must be after all route mounts) -----
app.use((req, res) => {
  res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });
});

// ----- Error handler (optional) -----
// app.use((err, req, res, next) => {
//   console.error("Unhandled error:", err);
//   res.status(500).json({ isSuccess: false, error: "SERVER_ERROR" });
// });

// NOTE: यह logger 404 के बाद है, इसलिए execute नहीं होगा.
// इसे ऊपर (core middleware के साथ) रखें अगर आपको हर request log करनी है।
app.use((req, res, next) => {
  console.log('>>> INCOMING REQUEST:', req.method, req.path, 'from', req.ip);
  next();
});

export default app;
