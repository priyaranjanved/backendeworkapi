// src/routes/workRoutes.js
import express from "express";
import Work from "../models/work.js";
import User from "../models/user.js";
import Engage from "../models/engage.model.js";
import mongoose from "mongoose";
const router = express.Router();

/**
 * Helper: normalize address payload (string or provider object) into a consistent object.
 * - Prefers explicit provider fields if present (district, county, etc.).
 * - If district not present, parse display_name/formatted and prefer parts[length - 4],
 *   fallback to parts[1] only if nothing else found.
 */
function normalizeAddress(raw) {
  if (!raw) return null;

  // Treat simple string as formatted/display_name
  if (typeof raw === "string") {
    const formattedStr = raw.trim();
    raw = { display_name: formattedStr, formatted: formattedStr };
  }

  const a = raw || {};

  // Try explicit provider fields first
  const possibleDistrict =
    a.district ||
    a.county ||
    a.state_district ||
    a.region ||
    a.city_district ||
    a.subdivision ||
    a.county_name ||
    null;

  // City/locality heuristics
  const city = a.city || a.town || a.village || a.hamlet || a.locality || a.county || null;

  // Street / neighbourhood
  const street = a.road || a.street || a.pedestrian || a.neighbourhood || a.suburb || null;

  // Postal / state / country
  const postalCode = a.postcode || a.postal_code || a.postal || null;
  const state = a.state || null;
  const country = a.country || null;
  const countryCode = a.country_code || (a.countryCode ? a.countryCode : null);
  const placeId = a.place_id || a.osm_id || a.placeId || null;

  // If no explicit district, try parse from formatted/display_name
  let parsedDistrict = possibleDistrict;
  const display = a.display_name || a.formatted || null;
  if (!parsedDistrict && display && typeof display === "string") {
    const parts = display.split(",").map((p) => p.trim()).filter(Boolean);
    // Preferred rule: parts[length - 4] when length >= 4 (matches your example pattern)
    if (parts.length >= 4) {
      const candidate = parts[parts.length - 4];
      if (candidate && candidate.length > 0) parsedDistrict = candidate;
    }
    // fallback to second element only if nothing found
    if (!parsedDistrict && parts.length >= 2) {
      parsedDistrict = parts[1];
    }
  }

  // Try infer city from display_name if explicit not present
  let inferredCity = city;
  if (!inferredCity && display && typeof display === "string") {
    const parts = display.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 1) inferredCity = parts[0];
  }

  const formatted =
    a.display_name ||
    a.formatted ||
    [street, inferredCity || city, parsedDistrict, state, postalCode, country].filter(Boolean).join(", ") ||
    null;

  return {
    formatted: formatted || null,
    street,
    locality: a.locality || a.suburb || null,
    city: inferredCity || city,
    district: parsedDistrict || null,
    state,
    postalCode,
    country,
    countryCode: countryCode ? String(countryCode).toUpperCase() : null,
    placeId,
    raw: a,
  };
}

/**
 * Build poster snapshot from a User doc (or partial)
 */
const buildPosterSnapshot = (user, fallbackUid) => {
  if (!user && !fallbackUid) return undefined;
  const u = user || {};
  return {
    uid: u.uid || fallbackUid || (u._id ? String(u._id) : ""),
    name: u.name || "",
    age: u.age != null ? Number(u.age) : undefined,
    mobile: u.mobile || "",
    type: u.type || u.role || "",
    gender: u.gender || "",
    planType: u.planType || "Basic",
  };
};

/**
 * Helper: returns true if request is from the owner of the workDoc.
 */
const isOwner = (req, workDoc) => {
  try {
    if (!workDoc) return false;
    if (req.user) {
      const reqUid = req.user.uid || (req.user._id ? String(req.user._id) : null);
      const postedUid = workDoc.postedByUid || workDoc.poster?.uid;
      if (reqUid && postedUid && String(reqUid) === String(postedUid)) return true;
      if (req.user._id && workDoc.postedBy) {
        return String(req.user._id) === String(workDoc.postedBy);
      }
    } else {
      const asUid = req.query?.asUid || req.query?.posterUid || req.body?.posterUid || req.body?.asUid;
      const postedUid = workDoc.postedByUid || workDoc.poster?.uid;
      if (asUid && postedUid && String(asUid) === String(postedUid)) return true;
    }
    return false;
  } catch (e) {
    return false;
  }
};

/**
 * Normalizer: convert a work doc (or plain object) so it contains top-level `visible`
 */
/**
 * Normalizer: convert a work doc (or plain object) so it contains top-level `visible`.
 * Also include review aggregates & recentReviews only if reviews exist.
 */
const normalizeWork = (w) => {
  if (!w) return w;
  const clone = { ...w };
  const locVisible = clone.location && typeof clone.location.visible !== "undefined" ? clone.location.visible : true;
  clone.visible = locVisible;

  // If reviews exist, expose aggregates and recent subset for quick UI; otherwise don't add fields
  try {
    const reviewsArr = Array.isArray(clone.reviews) ? clone.reviews.filter((r) => r && r.visible) : [];
    if (reviewsArr.length > 0) {
      clone.reviewCount = typeof clone.reviewCount === "number" ? clone.reviewCount : reviewsArr.length;
      clone.avgRating = typeof clone.avgRating === "number"
        ? clone.avgRating
        : Math.round((reviewsArr.reduce((s, r) => s + (Number(r.rating) || 0), 0) / Math.max(1, reviewsArr.length)) * 100) / 100;

      const recent = reviewsArr.slice(-3).reverse(); // newest first
      clone.recentReviews = recent.map((r) => ({
        _id: r._id,
        reviewerId: r.reviewerId,
        reviewerName: r.reviewerName,
        rating: r.rating,
        comment: r.comment,
        createdAt: r.createdAt,
      }));
    } else {
      delete clone.reviewCount;
      delete clone.avgRating;
      delete clone.recentReviews;
    }
  } catch (e) {
    // ignore – do not break normal flow
  }

  return clone;
};


/**
 * POST /api/works/upload
 * Accepts: { workName|name, coords, description, posterUid?, location?: { address } , address? }
 * - Supports legacy coords string or object, and legacy address string or structured object.
 * - Normalizes address with normalizeAddress() and saves it into location.address (object or null).
 */
router.post("/upload", async (req, res) => {
  try {
    const { workName, name, description = "", coords, posterUid } = req.body;
    const finalName = workName || name;

    if (!finalName || !coords || !posterUid) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });
    }

    // --- parse coords into GeoJSON [lng, lat]
    let lngLat = null;
    if (Array.isArray(coords) && coords.length >= 2) {
      const maybeLat = Number(coords[0]);
      const maybeLng = Number(coords[1]);
      if (Number.isFinite(maybeLat) && Number.isFinite(maybeLng)) {
        lngLat = [maybeLng, maybeLat];
      }
    } else if (typeof coords === "string") {
      const parts = coords.split(",").map((p) => p.trim());
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        lngLat = [lng, lat];
      }
    } else if (coords && typeof coords === "object" && (coords.lat !== undefined || coords.lng !== undefined)) {
      const lat = Number(coords.lat);
      const lng = Number(coords.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        lngLat = [lng, lat];
      }
    }

    if (!lngLat) {
      return res.status(400).json({ isSuccess: false, error: "INVALID_COORDS" });
    }

    // --- find latest existing work for this posterUid
    const latest = await Work.findOne({
      $or: [{ postedByUid: posterUid }, { "poster.uid": posterUid }],
    })
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    // --- decide visible for new work (inherit)
    let decidedVisible = true;
    if (latest) {
      if (latest.location && typeof latest.location.visible !== "undefined") {
        decidedVisible = !!latest.location.visible;
      } else if (typeof latest.visible !== "undefined") {
        decidedVisible = !!latest.visible;
      } else {
        decidedVisible = true;
      }
    }

    // --- determine posterBusy by checking Engage collection
    let posterBusy = false;
    try {
      const engageDoc = await Engage.findOne({
        $or: [{ userId: posterUid }, { userUid: posterUid }, { uid: posterUid }],
      })
        .sort({ updatedAt: -1, createdAt: -1 })
        .lean();

      if (engageDoc) {
        if (typeof engageDoc.isBusy === "boolean") posterBusy = !!engageDoc.isBusy;
        else if (typeof engageDoc.busy === "boolean") posterBusy = !!engageDoc.busy;
        else if (typeof engageDoc.status === "string") posterBusy = String(engageDoc.status).toLowerCase() === "busy";
        else posterBusy = false;
      } else {
        posterBusy = false;
      }
    } catch (e) {
      console.warn("Error checking engage status for", posterUid, e);
      posterBusy = false;
    }

    // --- normalize address (supports multiple input shapes)
    let addressPayload = null;
    try {
      const locFromBody = req.body && req.body.location;
      if (locFromBody && locFromBody.address !== undefined && locFromBody.address !== null) {
        addressPayload = normalizeAddress(locFromBody.address);
      } else if (req.body.address !== undefined && req.body.address !== null) {
        addressPayload = normalizeAddress(req.body.address);
      } else {
        addressPayload = null;
      }
    } catch (e) {
      addressPayload = null;
    }

    // --- build new Work document
    const now = new Date();
    const newWork = {
      name: finalName,
      workName: finalName,
      description: description || "",
      location: {
        type: "Point",
        coordinates: lngLat,
        visible: decidedVisible,
        visibleChangedAt: decidedVisible ? now : undefined,
        address: addressPayload, // structured object or null
      },
      visible: decidedVisible,
      postedByUid: posterUid,
      createdAt: now,
      updatedAt: now,
    };

    // --- denormalize poster snapshot (include posterBusy)
    try {
      const user = await User.findOne({ uid: posterUid }).lean().catch(() => null);
      if (user) {
        newWork.poster = {
          uid: user.uid || posterUid,
          name: user.name || user.fullName || "",
          age: user.age ?? null,
          mobile: user.mobile || user.phone || "",
          type: user.type || "",
          gender: user.gender || "",
          planType: user.planType || user.plan || "Basic",
          posterBusy: !!posterBusy,
          postedByUid: posterUid,
        };
      } else {
        newWork.poster = { uid: posterUid, name: "", posterBusy: !!posterBusy, postedByUid: posterUid };
      }
    } catch (snapErr) {
      newWork.poster = { uid: posterUid, name: "", posterBusy: !!posterBusy, postedByUid: posterUid };
    }

    // --- save
    const created = await Work.create(newWork);
    const saved = await Work.findById(created._id).lean();

    return res.json({ isSuccess: true, data: saved });
  } catch (err) {
    console.error("POST /api/works/upload error:", err);
    return res.status(500).json({ isSuccess: false, error: "UPLOAD_FAILED", errorDetail: err.message || String(err) });
  }
});

/**
 * GET /api/works/nearby
 * Query params:
 *  lat, lng (required)
 *  distance (km, default 2)
 *  work (optional prefix filter)
 *  page, limit
 */
// router.js (or wherever your routes live)
router.get("/nearby", async (req, res) => {
  try {
    // expected query params: lat, lng, distance (in km), work, page, limit
    const { lat, lng, distance = 2, work = "", page = 1, limit = 50 } = req.query;

    if (typeof lat === "undefined" || typeof lng === "undefined") {
      return res.status(400).json({ isSuccess: false, error: "Missing required query param: lat and lng" });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ isSuccess: false, error: "Invalid lat/lng" });
    }

    const distNum = Number(distance); // expected in kilometres from client
    if (Number.isNaN(distNum) || distNum < 0) {
      return res.status(400).json({ isSuccess: false, error: "Invalid distance" });
    }

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit || "50", 10)));

    // convert km -> meters for use in geoNear.maxDistance (Mongo uses meters for maxDistance in spherical)
    const maxMeters = distNum > 0 ? distNum * 1000 : 0;

    // optional work filter regex (safe-escaped)
    const workTrim = String(work || "").trim();
    const safeWorkRegex = workTrim
      ? { name: { $regex: "^" + workTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
      : null;

    const normalize = (w) => {
      const distanceKm =
        w.distanceKm != null
          ? Number(w.distanceKm)
          : w.dist && w.dist.calculated
          ? Number(w.dist.calculated) / 1000
          : null;
      return {
        _id: w._id,
        name: w.name,
        description: w.description,
        location: w.location,
        visible: w.location && typeof w.location.visible !== "undefined" ? !!w.location.visible : true,
        poster: w.poster || { uid: w.postedByUid || "", name: "" },
        postedByUid: w.postedByUid,
        postedBy: w.postedBy,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        distanceKm,
      };
    };

    const buildPipeline = (applyWorkFilter = false) => {
      const geoNear = {
        $geoNear: {
          near: { type: "Point", coordinates: [lngNum, latNum] }, // NOTE: [lng, lat]
          distanceField: "dist.calculated",
          spherical: true,
        },
      };
      if (maxMeters > 0) geoNear.$geoNear.maxDistance = maxMeters;

      const pipeline = [geoNear];

      pipeline.push({
        $match: {
          "location.visible": true,
          "poster.posterBusy": { $ne: true },
        },
      });

      if (applyWorkFilter && safeWorkRegex) pipeline.push({ $match: safeWorkRegex });

      pipeline.push({ $addFields: { distanceKm: { $divide: ["$dist.calculated", 1000] } } });
      pipeline.push({ $skip: (pageNum - 1) * limitNum });
      pipeline.push({ $limit: limitNum });
      pipeline.push({
        $project: {
          name: 1,
          description: 1,
          location: 1,
          poster: 1,
          postedByUid: 1,
          postedBy: 1,
          createdAt: 1,
          updatedAt: 1,
          distanceKm: 1,
          "dist.calculated": 1,
        },
      });
      return pipeline;
    };

    let results = [];
    let workMatched = true;

    try {
      if (safeWorkRegex) {
        const withWork = await Work.aggregate(buildPipeline(true)).allowDiskUse(true);
        if (Array.isArray(withWork) && withWork.length > 0) {
          results = withWork;
          workMatched = true;
        } else {
          const withoutWork = await Work.aggregate(buildPipeline(false)).allowDiskUse(true);
          results = withoutWork || [];
          workMatched = false;
        }
      } else {
        results = await Work.aggregate(buildPipeline(false)).allowDiskUse(true);
        workMatched = true;
      }
    } catch (aggErr) {
      // fallback: use $geoWithin + haversine if $geoNear fails (older Mongo or permissions)
      console.warn("geoNear failed, falling back to geoWithin. Error:", aggErr?.message || aggErr);

      // radius in radians for $centerSphere: meters / Earth's radius (in meters 6378137)
      const radiusInRadians = maxMeters > 0 ? maxMeters / 6378137 : (distNum * 1000) / 6378137;
      const baseQuery = {
        location: { $geoWithin: { $centerSphere: [[lngNum, latNum], radiusInRadians] } },
        "location.visible": true,
        "poster.posterBusy": { $ne: true },
      };

      let docs = [];
      if (safeWorkRegex) {
        docs = await Work.find({ $and: [baseQuery, safeWorkRegex] }).skip((pageNum - 1) * limitNum).limit(limitNum).lean().catch(() => []);
        if (docs.length === 0) {
          docs = await Work.find(baseQuery).skip((pageNum - 1) * limitNum).limit(limitNum).lean().catch(() => []);
          workMatched = false;
        } else {
          workMatched = true;
        }
      } else {
        docs = await Work.find(baseQuery).skip((pageNum - 1) * limitNum).limit(limitNum).lean().catch(() => []);
        workMatched = true;
      }

      // compute haversine distances (km)
      const toRad = (v) => (v * Math.PI) / 180;
      const haversineKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      const docsWithDistances = docs.map((d) => {
        const coords = Array.isArray(d.location?.coordinates) ? d.location.coordinates : null;
        let docLng = null, docLat = null;
        if (coords && coords.length >= 2) {
          docLng = coords[0];
          docLat = coords[1];
        }
        const distanceKm = docLat != null && docLng != null ? Number(haversineKm(latNum, lngNum, docLat, docLng)) : null;
        return { ...d, distanceKm };
      });

      docsWithDistances.sort((a, b) => {
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });

      const sliced = docsWithDistances.slice(0, limitNum);
      const normalized = sliced.map((w) => normalize(w));
      return res.json({ isSuccess: true, page: pageNum, limit: limitNum, count: normalized.length, workMatched, data: normalized });
    }

    // final filter (safety) and normalize
    // final filter (safety) and normalize
const final = (results || []).filter((r) => {
  if (!r || !r.location) return false;
  if (r.location.visible !== true) return false;
  if (r.poster && r.poster.posterBusy === true) return false;
  return true;
});

const normalized = final
  .map((w) => normalize(w))
  // 🔴 STRICT cutoff lagana zaroori hai
  .filter((w) => w.distanceKm != null && w.distanceKm <= distNum);

return res.json({
  isSuccess: true,
  page: pageNum,
  limit: limitNum,
  count: normalized.length,
  workMatched,
  data: normalized,
});

  } catch (err) {
    console.error("GET /nearby error:", err);
    return res.status(500).json({ isSuccess: false, error: "Server error: " + (err.message || "unknown") });
  }
});


/**
 * GET /api/works/
 * - If ownerUid equals requester, return all works for owner; otherwise only visible.
 */
router.get("/", async (req, res) => {
  try { 
    const ownerUid = req.query?.ownerUid;
    const asUid = req.query?.asUid;
    const requesterUid = req.user ? (req.user.uid || (req.user._id ? String(req.user._id) : null)) : asUid;

    if (ownerUid && requesterUid && String(ownerUid) === String(requesterUid)) {
      const user = await User.findOne({ uid: ownerUid }).lean().catch(() => null);
      const filter = user
        ? { $or: [{ postedBy: user._id }, { postedByUid: ownerUid }, { "poster.uid": ownerUid }] }
        : { $or: [{ postedByUid: ownerUid }, { "poster.uid": ownerUid }] };

      let q = Work.find(filter).sort({ createdAt: -1 });
      if (Work.schema.path("postedBy")) q = q.populate("postedBy", "uid name age mobile type gender planType");
      const works = await q.lean();
      const normalized = works.map(normalizeWork);
      return res.json({ isSuccess: true, count: normalized.length, data: normalized });
    }

    const q = Work.find({ "location.visible": true }).sort({ createdAt: -1 });
    let queryObj = q;
    if (Work.schema.path("postedBy")) queryObj = q.populate("postedBy", "uid name age mobile type gender planType");
    const works = await queryObj.lean();
    const normalized = works.map(normalizeWork);
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("GET / error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/**
 * GET /api/works/byUser/:uid
 */
router.get("/byUser/:uid", async (req, res) => {
  try {
    const { uid } = req.params;
    if (!uid) return res.status(400).json({ isSuccess: false, error: "UID required" });

    const user = await User.findOne({ uid }).lean().catch(() => null);

    const ownerIsRequester = (() => {
      if (req.user) {
        const reqUid = req.user.uid || (req.user._id ? String(req.user._id) : null);
        if (reqUid && String(reqUid) === String(uid)) return true;
      }
      const asUid = req.query?.asUid;
      if (asUid && String(asUid) === String(uid)) return true;
      return false;
    })();

    const baseFilter = user
      ? { $or: [{ postedBy: user._id }, { postedByUid: uid }, { "poster.uid": uid }] }
      : { $or: [{ postedByUid: uid }, { "poster.uid": uid }] };

    const finalFilter = ownerIsRequester ? baseFilter : { $and: [baseFilter, { "location.visible": true }] };

    let q = Work.find(finalFilter).sort({ createdAt: -1 });
    if (Work.schema.path("postedBy")) q = q.populate("postedBy", "uid name age mobile type gender planType");
    const works = await q.lean();
    const normalized = works.map(normalizeWork);
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("GET /byUser/:uid error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/**
 * POST /api/works/bulk-insert
 * Body: array of work documents for seeding
 */
router.post("/bulk-insert", async (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ isSuccess: false, error: "Data must be an array" });

    const docs = req.body.map((d) => {
      const copy = { ...d };
      if (!copy.location) copy.location = {};
      if (typeof copy.location.visible === "undefined") copy.location.visible = true;
      if (!copy.location.visibleChangedAt) copy.location.visibleChangedAt = new Date();
      // normalize any address inside bulk if present
      if (copy.location && copy.location.address) {
        copy.location.address = normalizeAddress(copy.location.address);
      } else if (copy.address) {
        copy.location.address = normalizeAddress(copy.address);
      }
      return copy;
    });

    const inserted = await Work.insertMany(docs);
    const normalized = inserted.map((i) => normalizeWork(i.toObject ? i.toObject() : i));
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("POST /bulk-insert error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/**
 * PATCH /api/works/:id
 * Accepts updates for name, description, coords, visible, and address.
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, coords, visible } = req.body;
    // accept posterUid either from body or query
    const posterUidFromBody = req.body?.posterUid;
    const posterUidFromQuery = req.query?.posterUid;
    const posterUid = posterUidFromBody || posterUidFromQuery;

    const existing = await Work.findById(id);
    if (!existing) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    // Ownership check
    let allowed = false;
    if (req.user) {
      const reqUid = req.user.uid || (req.user._id ? String(req.user._id) : null);
      const postedUidStored = existing.postedByUid || (existing.poster && existing.poster.uid);
      if (reqUid && postedUidStored && String(reqUid) === String(postedUidStored)) allowed = true;
      if (req.user.isAdmin) allowed = true;
    } else if (posterUid) {
      const postedUidStored = existing.postedByUid || (existing.poster && existing.poster.uid);
      if (postedUidStored && String(posterUid) === String(postedUidStored)) allowed = true;
    }

    if (!allowed) return res.status(403).json({ isSuccess: false, error: "FORBIDDEN" });

    // Build patch
    const patch = {};
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;

    // visible
    if (visible !== undefined) {
      patch["location.visible"] = !!visible;
      patch["location.visibleChangedAt"] = new Date();
    }

    // coords
    if (coords) {
      let lat = null;
      let lng = null;
      if (typeof coords === "string") {
        const parts = coords.split(",").map((s) => s.trim());
        if (parts.length >= 2) {
          const pLat = parseFloat(parts[0]);
          const pLng = parseFloat(parts[1]);
          if (!isNaN(pLat) && !isNaN(pLng)) {
            lat = pLat;
            lng = pLng;
          }
        }
      } else if (typeof coords === "object" && coords.lat !== undefined && coords.lng !== undefined) {
        lat = parseFloat(coords.lat);
        lng = parseFloat(coords.lng);
      }

      if (lat !== null && lng !== null) {
        const existingVisible = existing.location && typeof existing.location.visible !== "undefined" ? existing.location.visible : true;
        const existingVisibleChangedAt = existing.location ? existing.location.visibleChangedAt : undefined;

        patch["location.type"] = "Point";
        patch["location.coordinates"] = [lng, lat];

        if (visible === undefined) {
          patch["location.visible"] = existingVisible;
          if (existingVisibleChangedAt) patch["location.visibleChangedAt"] = existingVisibleChangedAt;
        }
      }
    }

    // address update (support multiple shapes)
    // priority:
    // 1) req.body.location.address
    // 2) req.body.address
    if (req.body.location && Object.prototype.hasOwnProperty.call(req.body.location, "address")) {
      const raw = req.body.location.address;
      if (raw === null) {
        patch["location.address"] = null;
      } else {
        patch["location.address"] = normalizeAddress(raw);
      }
    } else if (Object.prototype.hasOwnProperty.call(req.body, "address")) {
      const raw2 = req.body.address;
      if (raw2 === null) {
        patch["location.address"] = null;
      } else {
        patch["location.address"] = normalizeAddress(raw2);
      }
    }

    // perform update
    const updated = await Work.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    return res.json({ isSuccess: true, data: normalizeWork(updated) });
  } catch (err) {
    console.error("PATCH /api/works/:id error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/**
 * DELETE /api/works/:id
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Work.findById(id).lean();
    if (!existing) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    // Ownership check
    let allowed = false;
    if (req.user) {
      const reqUid = req.user.uid || (req.user._id ? String(req.user._id) : null);
      const posterUidStored = existing.postedByUid || (existing.poster && existing.poster.uid);
      if (reqUid && posterUidStored && String(reqUid) === String(posterUidStored)) allowed = true;
      if (req.user.isAdmin) allowed = true;
    } else {
      const posterUid = req.query?.posterUid || req.body?.posterUid || req.body?.asUid;
      const posterUidStored = existing.postedByUid || (existing.poster && existing.poster.uid);
      if (posterUid && posterUidStored && String(posterUid) === String(posterUidStored)) allowed = true;
    }

    if (!allowed) return res.status(403).json({ isSuccess: false, error: "FORBIDDEN" });

    const removed = await Work.findByIdAndDelete(id).lean();
    if (!removed) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    return res.json({ isSuccess: true, data: normalizeWork(removed) });
  } catch (err) {
    console.error("DELETE /api/works/:id error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});


/**
 * POST /api/works/:id/review
 * Body: { reviewerId (string), reviewerName?, rating (1..5), comment?, hireId? }
 * Atomically pushes a review into work.reviews and recomputes reviewCount/totalRating/avgRating.
 * NOTE: requires MongoDB 4.2+ for update pipeline. If older Mongo, we can implement a transaction alternative.
 */
// assume: import express, mongoose, Work at top of file
// router variable already defined

router.post("/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewerId, reviewerName = "", rating, comment = "", hireId = null } = req.body;

    if (!id || !reviewerId || rating == null) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });
    }

    const numRating = Number(rating);
    if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ isSuccess: false, error: "RATING_MUST_BE_1_TO_5" });
    }

    // ensure work exists
    const exists = await Work.exists({ _id: id });
    if (!exists) return res.status(404).json({ isSuccess: false, error: "WORK_NOT_FOUND" });

    const reviewObj = {
      reviewerId: String(reviewerId),
      reviewerName: String(reviewerName || "").trim(),
      rating: numRating,
      comment: String(comment || "").trim(),
      createdAt: new Date(),
      visible: true,
    };

    // attach hireId if provided & valid
    if (hireId && mongoose.Types.ObjectId.isValid(hireId)) {
      reviewObj.hireId = new mongoose.Types.ObjectId(hireId); // use `new` per mongoose v7+
    }

    /**
     * SAFER pipeline: always treat reviews as array using $ifNull
     * 1) append to reviews (concatArrays on ifNull("$reviews", []))
     * 2) compute visibleReviews from the new reviews array
     * 3) compute reviewCount, totalRating
     * 4) compute avgRating rounded to 2 decimals
     * 5) cleanup
     */
    const pipeline = [
      {
        $set: {
          reviews: {
            $concatArrays: [
              { $ifNull: ["$reviews", []] },
              [reviewObj]
            ]
          }
        }
      },
      {
        $set: {
          visibleReviews: {
            $filter: {
              input: { $ifNull: ["$reviews", []] }, // safe fallback
              as: "r",
              cond: { $eq: ["$$r.visible", true] }
            }
          }
        }
      },
      {
        $set: {
          reviewCount: { $size: "$visibleReviews" },
          totalRating: { $sum: { $map: { input: "$visibleReviews", as: "r", in: "$$r.rating" } } }
        }
      },
      {
        $set: {
          avgRating: {
            $cond: [
              { $gt: ["$reviewCount", 0] },
              { $round: [{ $divide: ["$totalRating", "$reviewCount"] }, 2] },
              0
            ]
          }
        }
      },
      { $unset: ["visibleReviews"] }
    ];

    const updated = await Work.findByIdAndUpdate(id, pipeline, { new: true }).lean();
    if (!updated) return res.status(404).json({ isSuccess: false, error: "WORK_NOT_FOUND" });

    const added = Array.isArray(updated.reviews) ? updated.reviews[updated.reviews.length - 1] : null;

    return res.json({
      isSuccess: true,
      data: { review: added, reviewCount: updated.reviewCount || 0, avgRating: updated.avgRating || 0 }
    });
  } catch (err) {
    console.error("POST /api/works/:id/review error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});



/**
 * GET /api/works/:id/reviews
 * Query: page, limit, sort (asc|desc). Returns only visible reviews (paginated).
 */
router.get("/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const sortOrder = req.query.sort === "asc" ? 1 : -1;

    const work = await Work.findById(id).select("reviews reviewCount avgRating").lean();
    if (!work) return res.status(404).json({ isSuccess: false, error: "WORK_NOT_FOUND" });

    const visible = Array.isArray(work.reviews) ? work.reviews.filter((r) => r && r.visible) : [];
    // sort by createdAt
    visible.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (sortOrder === -1) visible.reverse();

    const total = visible.length;
    const start = (page - 1) * limit;
    const pageSlice = visible.slice(start, start + limit);

    return res.json({
      isSuccess: true,
      data: { total, page, limit, reviews: pageSlice, reviewCount: work.reviewCount || total, avgRating: work.avgRating || 0 },
    });
  } catch (err) {
    console.error("GET /api/works/:id/reviews error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

export default router;
