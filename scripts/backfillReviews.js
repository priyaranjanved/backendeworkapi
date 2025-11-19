// scripts/backfillReviews.js
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

const MONGODB = process.env.MONGODB_URI || "mongodb://localhost:27017/yourdb";

async function run() {
  await mongoose.connect(MONGODB, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("Connected to DB:", MONGODB);

  const res = await mongoose.connection.db.collection("works").updateMany(
    { $or: [{ reviews: { $exists: false } }, { reviews: null }] },
    { $set: { reviews: [], reviewCount: 0, totalRating: 0, avgRating: 0 } }
  );

  console.log("Matched:", res.matchedCount, "Modified:", res.modifiedCount);
  await mongoose.disconnect();
  console.log("Done");
}

run().catch((e) => { console.error(e); process.exit(1); });
