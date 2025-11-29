// src/controllers/business.controller.js
import Business from "../models/business.js";
import path from "path";

/**
 * Helper: parse address safely from body
 */
const parseAddress = (address) => {
  if (!address) return null;

  // If address is string, try JSON, otherwise use as formatted text
  if (typeof address === "string") {
    try {
      const obj = JSON.parse(address);
      return obj && typeof obj === "object" ? obj : { formatted: address };
    } catch {
      return { formatted: address };
    }
  }

  // If address is already object
  if (typeof address === "object") {
    return address;
  }

  return null;
};

/**
 * Helper: build GeoJSON location from body
 * Supports:
 *  - body.location as JSON string / object
 *  - body.lat + body.lng
 */
const buildLocation = (body, parsedAddress) => {
  // Case 1: location field present
  if (body.location) {
    let loc;
    try {
      loc = typeof body.location === "string" ? JSON.parse(body.location) : body.location;
    } catch {
      throw new Error("Invalid location JSON");
    }

    // If frontend sent { lat, lng, ... } instead of GeoJSON, convert it
    if (loc.lat && loc.lng && !loc.type && !loc.coordinates) {
      const lat = parseFloat(loc.lat);
      const lng = parseFloat(loc.lng);

      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        throw new Error("Invalid lat/lng values");
      }

      return {
        type: "Point",
        coordinates: [lng, lat],
        address: loc.address || parsedAddress || null,
      };
    }

    // Otherwise assume it's valid GeoJSON
    return {
      type: loc.type,
      coordinates: loc.coordinates,
      address: loc.address || parsedAddress || null,
      visible: loc.visible ?? true,
    };
  }

  // Case 2: lat & lng directly in body
  if (body.lat && body.lng) {
    const lat = parseFloat(body.lat);
    const lng = parseFloat(body.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      throw new Error("Invalid lat/lng values");
    }

    return {
      type: "Point",
      coordinates: [lng, lat],
      address: parsedAddress,
    };
  }

  // Nothing provided
  throw new Error("Location (lat/lng) required");
};

/**
 * Create business
 * Expect:
 *  - multipart/form-data (with files) OR raw JSON (without files)
 *  - businessName (required)
 *  - businessDescription
 *  - location (JSON) OR lat & lng
 *  - address (string or JSON) optional
 *  - images[] (files)  OR  images (URL / URLs)
 *  - postedBy / postedByUid OR from req.user
 */
export const createBusiness = async (req, res) => {
  try {
    const {
      businessName,
      businessDescription,
      address,
      images,
      lat,
      lng,
      location: locationRaw,
    } = req.body;

    // ----- Basic validation -----
    if (!businessName || typeof businessName !== "string" || !businessName.trim()) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "businessName is required",
      });
    }

    // ----- Address -----
    const parsedAddress = parseAddress(address);

    // ----- Location -----
    let location;
    try {
      if (locationRaw) {
        // agar location JSON string / object diya ho
        let loc = locationRaw;
        if (typeof loc === "string") {
          loc = JSON.parse(loc);
        }
        location = buildLocation(
          {
            location: loc,
          },
          parsedAddress
        );
      } else if (lat && lng) {
        location = buildLocation({ lat, lng }, parsedAddress);
      } else {
        throw new Error("Location (lat/lng) required");
      }
    } catch (e) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: e.message || "Invalid location",
      });
    }

    // ----- Images from JSON -----
    let imageList = [];
    if (images) {
      if (Array.isArray(images)) {
        imageList = images.filter((x) => typeof x === "string" && x.trim().length > 0);
      } else if (typeof images === "string") {
        try {
          const arr = JSON.parse(images);
          if (Array.isArray(arr)) {
            imageList = arr.filter(
              (x) => typeof x === "string" && x.trim().length > 0
            );
          } else if (images.trim().length > 0) {
            imageList = [images.trim()];
          }
        } catch {
          if (images.trim().length > 0) {
            imageList = [images.trim()];
          }
        }
      }
    }

    // max 5 enforce (safety)
    if (imageList.length > 5) {
      imageList = imageList.slice(0, 5);
    }

    // ----- Poster info (optional) -----
    const postedBy = req.user?._id || req.body.postedBy || null;
    const postedByUid = req.user?.uid || req.body.postedByUid || null;

    const poster = req.user
      ? {
          uid: req.user.uid,
          name: req.user.name,
          age: req.user.age,
          mobile: req.user.mobile,
          type: req.user.type,
          gender: req.user.gender,
          planType: req.user.planType,
          posterBusy: req.user.posterBusy || false,
        }
      : undefined;

    // ----- Create & save -----
    const business = await Business.create({
      businessName: businessName.trim(),
      businessDescription,
      location,
      images: imageList,   // ⬅️ Yahi array MongoDB me save hoga
      postedBy,
      postedByUid,
      poster,
    });

    return res.status(201).json({
      isSuccess: true,
      data: business,
      error: null,
    });
  } catch (err) {
    console.error("Create business error:", err);

    if (err.name === "ValidationError") {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "Validation failed",
        details: err.errors,
      });
    }

    return res.status(500).json({
      isSuccess: false,
      data: null,
      error: err.message || "Server error",
    });
  }
};


/**
 * Get businesses posted by a given user
 * Query: ?userId=... OR ?userUid=...
 * OR takes from req.user (if auth used)
 */
export const getBusinessesByUser = async (req, res) => {
  try {
    const userId = req.query.userId || req.user?._id;
    const userUid = req.query.userUid || req.user?.uid;

    if (!userId && !userUid) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "userId or userUid required",
      });
    }

    const filter = {};
    if (userId) filter.postedBy = userId;
    else filter.postedByUid = userUid;

    const businesses = await Business.find(filter).sort({ createdAt: -1 }).lean();

    return res.json({
      isSuccess: true,
      data: businesses,
      error: null,
    });
  } catch (err) {
    console.error("Get businesses by user error:", err);
    return res.status(500).json({
      isSuccess: false,
      data: null,
      error: err.message || "Server error",
    });
  }
};


// GET /api/business/nearby?lat=&lng=&distance=&page=&limit=
export const getNearbyBusinesses = async (req, res) => {
  try {
    const {
      lat,
      lng,
      distance = 25,   // km
      page = 1,
      limit = 100,
    } = req.query;

    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        isSuccess: false,
        error: "Valid lat & lng are required",
      });
    }

    const distanceKm = Number(distance) > 0 ? Number(distance) : 25;
    const maxDistanceMeters = distanceKm * 1000;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(500, parseInt(limit, 10) || 100));
    const skip = (pageNum - 1) * limitNum;

    // MongoDB geoNear
    const results = await Business.aggregate([
      {
        $geoNear: {
          near: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          distanceField: "dist.calculated",
          maxDistance: maxDistanceMeters,
          spherical: true,
        },
      },
      // optional filters
      {
        $match: {
          "location.visible": { $ne: false }, // default true
        },
      },
      { $sort: { "dist.calculated": 1 } },
      { $skip: skip },
      { $limit: limitNum },
    ]);

    return res.json({
      isSuccess: true,
      data: results,
    });
  } catch (err) {
    console.error("getNearbyBusinesses error:", err);
    return res.status(500).json({
      isSuccess: false,
      error: "Failed to fetch nearby businesses",
    });
  }
};
/**
 * Get single business by id
 */
export const getBusiness = async (req, res) => {
  try {
    const id = req.params.id;
    const business = await Business.findById(id);

    if (!business) {
      return res.status(404).json({
        isSuccess: false,
        data: null,
        error: "Not found",
      });
    }

    return res.json({
      isSuccess: true,
      data: business,
      error: null,
    });
  } catch (err) {
    console.error("Get business error:", err);
    return res.status(500).json({
      isSuccess: false,
      data: null,
      error: err.message || "Server error",
    });
  }
};

