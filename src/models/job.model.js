import mongoose from "mongoose";

const JobSchema = new mongoose.Schema({
  englishJob: { type: String, required: true },
  hindiJob: { type: String, required: true }
});

const Job = mongoose.model("Job", JobSchema);

export default Job;
