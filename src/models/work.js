// src/models/work.js
import mongoose from "mongoose";

/**
 * Denormalized poster snapshot (stored on each Work doc)
 * Keeps a small copy of the user who posted the work for quick reads.
 */
const posterSnapshotSchema = new mongoose.Schema(
  {
    uid: { type: String },
    name: { type: String },
    age: { type: Number },
    mobile: { type: String },
    type: { type: String },
    gender: { type: String },
    planType: { type: String },
    posterBusy: { type: Boolean, required: false, default: false, index: true },
  },
  { _id: false }
);

/**
 * Optional structured address subdocument.
 * If frontend doesn't send address, we store null in location.address.
 */
const addressSchema = new mongoose.Schema(
  {
    formatted: { type: String, trim: true }, // full display string
    street: { type: String, trim: true },
    locality: { type: String, trim: true }, // neighbourhood/suburb
    city: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true },
    countryCode: { type: String, trim: true }, // ISO code e.g. IN
    placeId: { type: String, trim: true }, // optional provider id (google/osm)
  },
  { _id: false }
);

/**
 * Location subdocument schema.
 * - type: "Point"
 * - coordinates: [lng, lat]
 * - visible: whether this location/work should be discoverable in search
 * - visibleChangedAt: timestamp when visibility last changed
 * - address: optional structured address or null
 */
const locationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], required: true },

    // GeoJSON coordinates order MUST be [lng, lat]
    coordinates: {
      type: [Number], // [lng, lat]
      required: true,
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length === 2 && arr.every((n) => typeof n === "number");
        },
        message: "coordinates must be an array of two numbers: [lng, lat]",
      },
    },

    // Optional structured address. If not provided, defaults to null.
    address: {
      type: addressSchema,
      default: null,
    },

    // Whether this work is discoverable in search/nearby queries.
    visible: { type: Boolean, default: true, index: true },

    // Optional: record when visibility last changed (useful for auditing)
    visibleChangedAt: { type: Date, required: false },
  },
  { _id: false }
);

/**
 * Review subdocument schema.
 */
const reviewSchema = new mongoose.Schema(
  {
    reviewerId: { type: String, required: true }, // uid ya userId
    reviewerName: { type: String, default: "" },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, default: "" },
    hireId: { type: mongoose.Schema.Types.ObjectId, ref: "Hire" },
    createdAt: { type: Date, default: Date.now },
    visible: { type: Boolean, default: true },
  },
  { _id: true }
);

/**
 * Work (skill/location) schema
 */
const workSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },

    // location subdocument (GeoJSON Point + visibility + optional address)
    location: { type: locationSchema, required: true },

    // reference to User (optional)
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },

    // denormalized poster snapshot for quick reads
    poster: posterSnapshotSchema,

    // optional legacy uid string
    postedByUid: { type: String, required: false },


    // (Optional) top-level visible left undefined for backward-compatibility if you still have old docs.
    // You may remove this field if you fully migrate to location.visible.
    // visible: { type: Boolean, default: undefined },
     // ⭐ Reviews & Rating fields
    reviews: { type: [reviewSchema], default: [] },
    reviewCount: { type: Number, default: 0, index: true },
    totalRating: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0, index: true },
  
  },
  { timestamps: true }
);

/**
 * Indexes:
 * - 2dsphere index on location for geo queries (must be first in compound with geospatial queries)
 * - compound index with location.visible to accelerate "visible + near" queries
 */
workSchema.index({ location: "2dsphere" });
workSchema.index({ location: "2dsphere", "location.visible": 1 });
// also add a simple index on postedByUid for by-user lookups
workSchema.index({ postedByUid: 1 });
// ADD these for the nested poster flag
workSchema.index({ "poster.posterBusy": 1 });
workSchema.index({ "location.visible": 1, "poster.posterBusy": 1 });
workSchema.index({ avgRating: -1 });
workSchema.index({ reviewCount: -1 });

export default mongoose.model("Work", workSchema);
