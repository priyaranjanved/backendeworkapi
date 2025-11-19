// src/models/business.js
import mongoose from "mongoose";

/* -------------------- Reusable Sub Schemas -------------------- */

// Small snapshot of the business owner (denormalized for quick reads)
const ownerSnapshotSchema = new mongoose.Schema(
  {
    uid: { type: String },
    name: { type: String },
    mobile: { type: String },
    type: { type: String },   // e.g. "individual" | "company" | plan tier, etc.
    planType: { type: String },
    ownerBusy: { type: Boolean, default: false, index: true },
  },
  { _id: false }
);

// Structured address (optional)
const addressSchema = new mongoose.Schema(
  {
    formatted: { type: String, trim: true },
    street: { type: String, trim: true },
    locality: { type: String, trim: true },
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
    countryCode: { type: String, trim: true }, // ISO e.g. IN
    placeId: { type: String, trim: true },
  },
  { _id: false }
);

// Geo location + visibility
const locationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      validate: {
        validator(arr) {
          return Array.isArray(arr) && arr.length === 2 && arr.every((n) => typeof n === "number");
        },
        message: "coordinates must be [lng, lat]",
      },
    },
    address: { type: addressSchema, default: null },
    visible: { type: Boolean, default: true, index: true },
    visibleChangedAt: { type: Date },
  },
  { _id: false }
);

// Audit trail event
const auditEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["create", "update", "delete", "restore", "location_update", "visibility_change"],
      required: true,
    },
    byUserId: { type: String, required: true },    // actor uid
    byName: { type: String, default: "" },         // actor display name (optional)
    at: { type: Date, default: Date.now },
    // Optional granular change summary (keep small; big diffs store elsewhere if needed)
    changes: {
      type: [
        new mongoose.Schema(
          {
            field: { type: String, required: true }, // e.g. "name", "location.address.city"
            from: { type: mongoose.Schema.Types.Mixed },
            to: { type: mongoose.Schema.Types.Mixed },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    note: { type: String, trim: true, default: "" },
  },
  { _id: true }
);

/* -------------------- Business Schema -------------------- */

const businessSchema = new mongoose.Schema(
  {
    // Basic business fields
    name: { type: String, required: true, trim: true },
    category: { type: String, index: true, trim: true },       // e.g. "Plumber", "Salon"
    subCategory: { type: String, trim: true },
    description: { type: String, trim: true },
    services: { type: [String], default: [] },                  // tags/keywords
    photos: { type: [String], default: [] },                    // URLs
    website: { type: String, trim: true },
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    whatsapp: { type: String, trim: true },
    gstin: { type: String, trim: true },                        // optional for India
    openingHours: {
      type: new mongoose.Schema(
        {
          mon: { type: String, default: "" }, // e.g. "09:00-18:00" or "Closed"
          tue: { type: String, default: "" },
          wed: { type: String, default: "" },
          thu: { type: String, default: "" },
          fri: { type: String, default: "" },
          sat: { type: String, default: "" },
          sun: { type: String, default: "" },
        },
        { _id: false }
      ),
      default: {},
    },

    // Location
    location: { type: locationSchema, required: true },

    // Ownership (refs + snapshot)
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
    ownerUid: { type: String, required: false, index: true },   // legacy / alt lookup
    ownerSnapshot: ownerSnapshotSchema,

    // Moderation / lifecycle
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: String },                                 // uid who deleted

    // Audit trail
    auditTrail: { type: [auditEventSchema], default: [] },

    // Ratings (optional; matches Work style)
    reviews: {
      type: [
        new mongoose.Schema(
          {
            reviewerId: { type: String, required: true },
            reviewerName: { type: String, default: "" },
            rating: { type: Number, min: 1, max: 5, required: true },
            comment: { type: String, trim: true, default: "" },
            createdAt: { type: Date, default: Date.now },
            visible: { type: Boolean, default: true },
          },
          { _id: true }
        ),
      ],
      default: [],
    },
    reviewCount: { type: Number, default: 0, index: true },
    totalRating: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

/* -------------------- Indexes -------------------- */

// Geospatial for nearby queries
businessSchema.index({ location: "2dsphere" });
// Compound for visible + nearby
businessSchema.index({ location: "2dsphere", "location.visible": 1 });
// Quick lookups
businessSchema.index({ name: 1 });
businessSchema.index({ category: 1, subCategory: 1 });
businessSchema.index({ isDeleted: 1 });
businessSchema.index({ "ownerSnapshot.ownerBusy": 1 });
// Text search (name + description + services)
businessSchema.index({ name: "text", description: "text", services: "text" });

/* -------------------- Helper Methods -------------------- */

/**
 * Push a single audit event.
 * @param {Object} params - { action, actor: {uid, name}, changes?, note? }
 */
businessSchema.methods.recordAudit = function recordAudit(params = {}) {
  const { action, actor = {}, changes = [], note = "" } = params;
  this.auditTrail.push({
    action,
    byUserId: actor.uid,
    byName: actor.name || "",
    at: new Date(),
    changes,
    note,
  });
};

/**
 * Soft delete the business (with audit)
 */
businessSchema.methods.softDelete = async function softDelete(actor = {}, note = "") {
  if (this.isDeleted) return this;
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = actor.uid;
  this.recordAudit({ action: "delete", actor, note });
  await this.save();
  return this;
};

/**
 * Restore soft-deleted business (with audit)
 */
businessSchema.methods.restore = async function restore(actor = {}, note = "") {
  if (!this.isDeleted) return this;
  this.isDeleted = false;
  this.deletedAt = undefined;
  this.deletedBy = undefined;
  this.recordAudit({ action: "restore", actor, note });
  await this.save();
  return this;
};

/**
 * Update location (coordinates/address/visibility) in one go with audit.
 * @param {Object} payload - { coordinates?: [lng, lat], address?, visible? }
 */
businessSchema.methods.updateLocation = async function updateLocation(payload = {}, actor = {}, note = "") {
  const changes = [];

  if (payload.coordinates) {
    changes.push({ field: "location.coordinates", from: this.location.coordinates, to: payload.coordinates });
    this.location.coordinates = payload.coordinates;
  }
  if (typeof payload.visible === "boolean" && payload.visible !== this.location.visible) {
    changes.push({ field: "location.visible", from: this.location.visible, to: payload.visible });
    this.location.visible = payload.visible;
    this.location.visibleChangedAt = new Date();
    // Also record a specific visibility change event for clarity
    this.recordAudit({ action: "visibility_change", actor, changes: [], note });
  }
  if (payload.address) {
    changes.push({ field: "location.address", from: this.location.address, to: payload.address });
    this.location.address = payload.address;
  }

  // Main location_update event
  this.recordAudit({ action: "location_update", actor, changes, note });

  await this.save();
  return this;
};

/* -------------------- Middleware (Optional patterns) -------------------- */

/**
 * Example: Auto-calc avgRating from reviews before save
 */
businessSchema.pre("save", function calcAvgRating(next) {
  if (Array.isArray(this.reviews)) {
    this.reviewCount = this.reviews.length;
    this.totalRating = this.reviews.reduce((s, r) => s + (r.rating || 0), 0);
    this.avgRating = this.reviewCount ? this.totalRating / this.reviewCount : 0;
  }
  next();
});

export default mongoose.model("Business", businessSchema);
