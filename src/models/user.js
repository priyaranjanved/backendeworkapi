// ./models/user.model.js
// import mongoose from "mongoose";

// const UserSchema = new mongoose.Schema({
//   uid: { type: String, required: true, unique: true, index: true },
//   aadhaar: { type: String, required: true, index: true },
//   name: { type: String, default: "" },
//   mobile: { type: String, default: "" },
//   age: { type: Number, default: null }, // new
//   gender: { type: String, enum: ["Male", "Female", "Other"], default: null }, // new
//   createdAt: { type: Date, default: Date.now }
// }, { timestamps: true });

// export default mongoose.model("User", UserSchema);
// ./models/user.model.js
// Simple, single-file User schema with plan + 1-year insurance logic

import mongoose from "mongoose";

// Small insurance subdocument (stored only when user has/had insurance)
const InsuranceSchema = new mongoose.Schema({
  enabled: { type: Boolean, required: true },      // true when active
  startDate: { type: Date, required: true },       // when insurance started
  endDate: { type: Date, required: true }          // when insurance ends (start + 1 year)
}, { _id: false });

const UserSchema = new mongoose.Schema({
  uid: { type: String, required: true, unique: true, index: true },
  aadhaar: { type: String, required: true, index: true },
  name: { type: String, default: "" },
  mobile: { type: String, default: "" },
  age: { type: Number, default: null },
  gender: { type: String, enum: ["Male", "Female", "Other"], default: null },

  // plan: Basic or Premium
  planType: {
    type: String,
    enum: ["Basic", "Premium"],
    required: true,
    default: "Basic"
  },

  // insurance stored as subdocument; default null for Basic users
  insurance: {
    type: InsuranceSchema,
    default: null
  }
}, { timestamps: true });

// helper: return date + N years
function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

// Activate or renew insurance for 1 year from now
UserSchema.methods.activateInsurance = async function() {
  const now = new Date();
  this.planType = "Premium";
  this.insurance = {
    enabled: true,
    startDate: now,
    endDate: addYears(now, 1)
  };
  return this.save();
};

// Check and expire insurance if endDate passed. Optionally downgrade to Basic
UserSchema.methods.checkAndExpireInsurance = async function(downgradeToBasic = true) {
  if (!this.insurance || !this.insurance.enabled) return false;
  const now = new Date();
  if (this.insurance.endDate && now > this.insurance.endDate) {
    this.insurance.enabled = false;
    if (downgradeToBasic) this.planType = "Basic";
    await this.save();
    return true; // expired now
  }
  return false; // still active
};

// Optionally disable insurance manually (keeps history)
UserSchema.methods.disableInsurance = async function() {
  if (!this.insurance) return this;
  this.insurance.enabled = false;
  await this.save();
  return this;
};

export default mongoose.model('User', UserSchema);

