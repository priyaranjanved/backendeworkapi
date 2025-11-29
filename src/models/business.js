// src/models/business.js
import mongoose from "mongoose";

/** reuse poster snapshot like your work.js */
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
    countryCode: { type: String, trim: true },
    placeId: { type: String, trim: true },
  },
  { _id: false }
);

const locationSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["Point"], required: true },
    // store as [lng, lat] (GeoJSON)
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length === 2 && arr.every((n) => typeof n === "number");
        },
        message: "coordinates must be [lng, lat]",
      },
    },
    address: { type: addressSchema, default: null },
    visible: { type: Boolean, default: true, index: true },
    visibleChangedAt: { type: Date, required: false },
  },
  { _id: false }
);

const businessSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    businessDescription: { type: String, trim: true },

    // Geo location like your work schema
    location: { type: locationSchema, required: true },

    // reference to User who posted
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },

    // denormalized poster snapshot for quick reads
    poster: posterSnapshotSchema,

    postedByUid: { type: String, required: false },

    // images (max 5). store full URLs or relative paths.
    images: { type: [String], default: [] },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Indexes for geo queries and lookups by user
businessSchema.index({ location: "2dsphere" });
businessSchema.index({ postedBy: 1 });
businessSchema.index({ postedByUid: 1 });
businessSchema.index({ "location.visible": 1 });

export default mongoose.model("Business", businessSchema);
