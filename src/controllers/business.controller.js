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
// 👇 नया simple createBusiness
export const createBusiness = async (req, res) => {
  try {
    const {
      businessName,
      businessDescription,
      lat,
      lng,
      address,      // string "Buxar, Bihar, India"
      images,       // array (base64/url), optional
      postedByUid,  // optional, mobile se aa raha hai
      postedBy,     // optional
    } = req.body;

    // ------- Basic validation -------
    if (!businessName || !businessName.trim()) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "businessName is required",
      });
    }

    if (lat == null || lng == null) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "lat & lng are required",
      });
    }

    const latitude = Number(lat);
    const longitude = Number(lng);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "Invalid lat/lng values",
      });
    }

    // ------- Images (max 5) -------
    let imageList = [];
    if (Array.isArray(images)) {
      imageList = images
        .filter((x) => typeof x === "string" && x.trim().length > 0)
        .slice(0, 5);
    }

    // ------- Location object (schema ke according) -------
    const location = {
      type: "Point",
      coordinates: [longitude, latitude], // [lng, lat]
      address: {
        formatted: address || "",
      },
      visible: true,
    };

    // ------- Create & save -------
    const business = await Business.create({
      businessName: businessName.trim(),
      businessDescription,
      location,
      images: imageList,
      postedBy: postedBy || null,
      postedByUid: postedByUid || null,
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
 * GET /api/business/byUser/:uid
 *  - :uid  = user ka UID (jaise "USR-1759942756529-7456")
 *  - ?asUid= agar requester khud hi same uid bhejta hai to hidden (visible:false) bhi milेंगे
 */
export const getBusinessesByUserUid = async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) {
      return res
        .status(400)
        .json({ isSuccess: false, data: null, error: "UID required" });
    }

    // Agar tum user collection me bhi uid save karte ho to ye try karega
    const user = await User.findOne({ uid }).lean().catch(() => null);

    // Check: kya request karne wala user bhi yehi uid hai?
    const ownerIsRequester = (() => {
      if (req.user) {
        const reqUid =
          req.user.uid || (req.user._id ? String(req.user._id) : null);
        if (reqUid && String(reqUid) === String(uid)) return true;
      }
      const asUid = req.query?.asUid;
      if (asUid && String(asUid) === String(uid)) return true;
      return false;
    })();

    // Base filter: postedBy OR postedByUid
    const baseFilter = user
      ? {
          $or: [
            { postedBy: user._id }, // agar postedBy me ObjectId store hai
            { postedByUid: uid },   // screenshot wala field
          ],
        }
      : {
          postedByUid: uid,
        };

    // Agar khud hi dekh raha hai -> sab dikhao
    // warna sirf wahi jahan location.visible !== false
    const finalFilter = ownerIsRequester
      ? baseFilter
      : {
          $and: [baseFilter, { "location.visible": { $ne: false } }],
        };

    let q = Business.find(finalFilter).sort({ createdAt: -1 });

    // optional: agar schema me postedBy ref hai to populate
    if (Business.schema.path("postedBy")) {
      q = q.populate(
        "postedBy",
        "uid name age mobile type gender planType"
      );
    }

    const businesses = await q.lean();

    return res.json({
      isSuccess: true,
      count: businesses.length,
      data: businesses,
      error: null,
    });
  } catch (err) {
    console.error("GET /business/byUser/:uid error:", err);
    return res.status(500).json({
      isSuccess: false,
      data: null,
      error: err.message || "Server error",
    });
  }
};
/**
 * DELETE /api/business/:id?uid=USR-xxxx
 *  - id  = business _id
 *  - uid = postedByUid (sirf apna hi business delete kar sake)
 */
export const deleteBusinessByIdAndUid = async (req, res) => {
  try {
    const { id } = req.params;
    const uid =
      req.query.uid || req.query.asUid || req.user?.uid || null;

    if (!id) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "Business id is required",
      });
    }

    if (!uid) {
      return res.status(400).json({
        isSuccess: false,
        data: null,
        error: "uid (postedByUid) is required to delete business",
      });
    }

    // Ensure ye business isi uid ka ho
    const existing = await Business.findOne({ _id: id, postedByUid: uid });

    if (!existing) {
      return res.status(404).json({
        isSuccess: false,
        data: null,
        error: "Business not found for this uid",
      });
    }

    await Business.deleteOne({ _id: id });

    return res.json({
      isSuccess: true,
      data: { _id: id },
      error: null,
    });
  } catch (err) {
    console.error("Delete business error:", err);
    return res.status(500).json({
      isSuccess: false,
      data: null,
      error: err.message || "Server error",
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

