// ./models/KycCardUser.js
// KYC Card User schema with plan + 1-year planInsurance logic (Basic/Premium)

import mongoose from "mongoose";

const FacePhotoSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },

    // ✅ URL optional (because base64 can be stored too)
    url: { type: String, required: false, default: null },

    // ✅ base64 data url
    // Example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
    data: { type: String, required: false, default: null },
  },
  { _id: false }
);

// ✅ planInsurance subdocument (like User insurance)
const PlanInsuranceSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, required: true }, // true when active
    startDate: { type: Date, required: true }, // premium start
    endDate: { type: Date, required: true },   // premium end (start + 1 year)
  },
  { _id: false }
);

const KycCardUserSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, index: true },
    dob: { type: Date, required: true },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, required: true, enum: ["male", "female", "other"] },

    // plan: Basic or Premium
    planType: {
      type: String,
      enum: ["Basic", "Premium"],
      required: true,
      default: "Basic",
    },

    // ✅ planInsurance stored only when activated; null for Basic users
    planInsurance: {
      type: PlanInsuranceSchema,
      default: null,
    },

    // ✅ FacePhoto required but inside fields can be url OR data
    facePhoto: {
      type: FacePhotoSchema,
      required: true,
      validate: {
        validator: function (v) {
          return !!(v && (v.url || v.data));
        },
        message: "facePhoto must contain either url or data",
      },
    },
  },
  { timestamps: true }
);

// helper: return date + N years
function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

/**
 * ✅ Activate/renew Premium for 1 year from now
 * - sets planType = Premium
 * - sets planInsurance enabled true with start/end
 */
KycCardUserSchema.methods.activatePlanInsurance = async function () {
  const now = new Date();
  this.planType = "Premium";
  this.planInsurance = {
    enabled: true,
    startDate: now,
    endDate: addYears(now, 1),
  };
  return this.save();
};

/**
 * ✅ Check & expire Premium if endDate passed
 * - disables planInsurance
 * - optionally downgrades to Basic (default true)
 * Returns: true if expired now else false
 */
KycCardUserSchema.methods.checkAndExpirePlanInsurance = async function (
  downgradeToBasic = true
) {
  if (!this.planInsurance || !this.planInsurance.enabled) return false;

  const now = new Date();
  if (this.planInsurance.endDate && now > this.planInsurance.endDate) {
    this.planInsurance.enabled = false;
    if (downgradeToBasic) this.planType = "Basic";
    await this.save();
    return true; // expired now
  }
  return false; // still active
};

/**
 * ✅ Manually disable planInsurance (keeps history)
 */
KycCardUserSchema.methods.disablePlanInsurance = async function () {
  if (!this.planInsurance) return this;
  this.planInsurance.enabled = false;
  await this.save();
  return this;
};

const KycCardUser = mongoose.model("KycCardUser", KycCardUserSchema);

export default KycCardUser;
