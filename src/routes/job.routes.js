import express from "express";
import Job from "../models/job.model.js";

const router = express.Router();

// ✅ GET: Search jobs for autosuggest
router.get("/search", async (req, res) => {
  try {
    const keyword = req.query.q || "";
    const jobs = await Job.find({
      $or: [
        { englishJob: new RegExp(keyword, "i") },
        { hindiJob: new RegExp(keyword, "i") }
      ]
    }).limit(10);
    res.json({ isSuccess: true, data: jobs, error: null });
  } catch (error) {
    res.json({ isSuccess: false, data: null, error: error.message });
  }
});

router.post("/bulk-insert", async (req, res) => {
  try {
    const data = req.body;
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ isSuccess: false, error: "Send an array of job records" });
    }

    const result = await Job.insertMany(data, { ordered: false });
    res.json({ isSuccess: true, insertedCount: result.length, data: result });
  } catch (err) {
    res.status(500).json({ isSuccess: false, error: err.message });
  }
});


export default router;   // 👈 IMPORTANT
