// scripts/backfillPosterBusy.js
import mongoose from "mongoose";
import Work from "../src/models/work.js";
import Engagement from "../src/models/engagement.js"; // adjust path if needed

const MONGO = process.env.MONGO_URI || "mongodb://localhost:27017/erojgarDb";

async function main() {
  await mongoose.connect(MONGO, { useNewUrlParser: true, useUnifiedTopology: true });
  try {
    const engaged = await Engagement.find({}).lean().catch(() => []);
    const statusMap = new Map();
    (engaged || []).forEach(d => { if (d.userId) statusMap.set(String(d.userId), String(d.status || "")); });

    let updated = 0;
    const cursor = Work.find({}).cursor();
    for await (const w of cursor) {
      const posterUid = (w.postedByUid || (w.poster && w.poster.uid) || "").toString();
      const status = posterUid ? (statusMap.get(posterUid) || "free") : "free";
      const shouldBeBusy = status === "busy";
      const currentBusy = !!(w.poster && w.poster.posterBusy);
      if (currentBusy !== shouldBeBusy) {
        await Work.updateOne({ _id: w._id }, { $set: { "poster.posterBusy": shouldBeBusy } });
        updated++;
      }
    }
    console.log("Backfill complete. Updated:", updated);
  } catch (err) {
    console.error("Backfill error:", err);
  } finally {
    await mongoose.disconnect();
  }
}

main();
