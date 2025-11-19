import mongoose from "mongoose";
import xlsx from "xlsx";
import dotenv from "dotenv";
import connectDB from "../config/db.js";
import Job from "../models/job.model.js";

dotenv.config();

// ✅ Connect to DB
await connectDB();

// ✅ Read Excel file (must be in root folder)
const workbook = xlsx.readFile("./worker_skills.xlsx");
const sheetName = workbook.SheetNames[0];
const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);

// ✅ Import into MongoDB
async function importJobs() {
  try {
    // Clear old jobs before inserting
    await Job.deleteMany();

    // Insert new jobs
    await Job.insertMany(
      data.map(row => ({
        englishJob: row["English Job"],
        hindiJob: row["Hindi Job"],
      }))
    );

    console.log("✅ Jobs Imported Successfully!");
    process.exit();
  } catch (error) {
    console.error("❌ Error Importing Jobs:", error);
    process.exit(1);
  }
}

// Run the import
await importJobs();
