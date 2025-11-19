// src/routes/businessRoutes.js
import express from "express";
import mongoose from "mongoose";
import Business from "../models/business.js";
import User from "../models/user.js";

const router = express.Router();

/* -------------------------------------------------------
 * Helpers: address normalizer (same philosophy as Work)
 * -----------------------------------------------------*/
function normalizeAddress(raw) {
  if (!raw) return null;

  if (typeof raw === "string") {
    const formattedStr = raw.trim();
    raw = { display_name: formattedStr, formatted: formattedStr };
  }

  const a = raw || {};
  const possibleDistrict =
    a.district ||
    a.county ||
    a.state_district ||
    a.region ||
    a.city_district ||
    a.subdivision ||
    a.county_name ||
    null;

  const city = a.city || a.town || a.village || a.hamlet || a.locality || a.county || null;
  const street = a.road || a.street || a.pedestrian || a.neighbourhood || a.suburb || null;

  const postalCode = a.postcode || a.postal_code || a.postal || null;
  const state = a.state || null;
  const country = a.country || null;
  const countryCode = a.country_code || (a.countryCode ? a.countryCode : null);
  const placeId = a.place_id || a.osm_id || a.placeId || null;

  let parsedDistrict = possibleDistrict;
  const display = a.display_name || a.formatted || null;
  if (!parsedDistrict && display && typeof display === "string") {
    const parts = display.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 4) {
      const candidate = parts[parts.length - 4];
      if (candidate && candidate.length > 0) parsedDistrict = candidate;
    }
    if (!parsedDistrict && parts.length >= 2) {
      parsedDistrict = parts[1];
    }
  }

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

/* -------------------------------------------------------
 * Helpers: ownership + normalizer
 * -----------------------------------------------------*/
const isOwner = (req, bizDoc) => {
  try {
    if (!bizDoc) return false;
    if (req.user) {
      const reqUid = req.user.uid || (req.user._id ? String(req.user._id) : null);
      const ownerUid = bizDoc.ownerUid || bizDoc.ownerSnapshot?.uid;
      if (reqUid && ownerUid && String(reqUid) === String(ownerUid)) return true;
      if (req.user._id && bizDoc.owner) {
        return String(req.user._id) === String(bizDoc.owner);
      }
      if (req.user.isAdmin) return true;
    } else {
      const asUid = req.query?.asUid || req.query?.ownerUid || req.body?.ownerUid;
      const ownerUid = bizDoc.ownerUid || bizDoc.ownerSnapshot?.uid;
      if (asUid && ownerUid && String(asUid) === String(ownerUid)) return true;
    }
    return false;
  } catch {
    return false;
  }
};

const normalizeBusiness = (b) => {
  if (!b) return b;
  const clone = { ...b };
  const locVisible = clone.location && typeof clone.location.visible !== "undefined" ? clone.location.visible : true;
  clone.visible = locVisible;

  // reviews aggregates only if present
  try {
    const reviewsArr = Array.isArray(clone.reviews) ? clone.reviews.filter((r) => r && r.visible) : [];
    if (reviewsArr.length > 0) {
      clone.reviewCount = typeof clone.reviewCount === "number" ? clone.reviewCount : reviewsArr.length;
      const sum = reviewsArr.reduce((s, r) => s + (Number(r.rating) || 0), 0);
      clone.avgRating = typeof clone.avgRating === "number"
        ? clone.avgRating
        : Math.round((sum / Math.max(1, reviewsArr.length)) * 100) / 100;

      const recent = reviewsArr.slice(-3).reverse();
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
  } catch {
    /* noop */
  }

  return clone;
};

/* -------------------------------------------------------
 * POST /api/business/upload   (Create with audit)
 * Body expected: {
 *   name, category?, subCategory?, description?, services?, phone?, whatsapp?,
 *   email?, website?, gstin?, openingHours?, ownerUid (required),
 *   coords | location: { coordinates?, address?, visible? } | address
 * }
 * coords can be "lat,lng" or {lat, lng} or [lat, lng]
 * -----------------------------------------------------*/
router.post("/upload", async (req, res) => {
  try {
    const { name, ownerUid } = req.body;
    if (!name || !ownerUid) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });
    }

    // parse coords
    const coordsIn = req.body.coords || req.body.location?.coordinates || req.body.location?.coords;
    let lngLat = null;
    if (Array.isArray(coordsIn) && coordsIn.length >= 2) {
      const maybeLat = Number(coordsIn[0]);
      const maybeLng = Number(coordsIn[1]);
      if (Number.isFinite(maybeLat) && Number.isFinite(maybeLng)) lngLat = [maybeLng, maybeLat];
    } else if (typeof coordsIn === "string") {
      const parts = coordsIn.split(",").map((p) => p.trim());
      const lat = parseFloat(parts[0]);
      const lng = parseFloat(parts[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) lngLat = [lng, lat];
    } else if (coordsIn && typeof coordsIn === "object" && (coordsIn.lat !== undefined || coordsIn.lng !== undefined)) {
      const lat = Number(coordsIn.lat);
      const lng = Number(coordsIn.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) lngLat = [lng, lat];
    }

    if (!lngLat) {
      return res.status(400).json({ isSuccess: false, error: "INVALID_COORDS" });
    }

    // address normalize
    let addressPayload = null;
    const locFromBody = req.body.location;
    if (locFromBody && Object.prototype.hasOwnProperty.call(locFromBody, "address")) {
      addressPayload = normalizeAddress(locFromBody.address);
    } else if (Object.prototype.hasOwnProperty.call(req.body, "address")) {
      addressPayload = normalizeAddress(req.body.address);
    }

    // visible inheritance not strictly needed; default true
    const visible = typeof req.body.location?.visible === "boolean" ? !!req.body.location.visible : true;

    // Owner snapshot
    let ownerSnapshot = { uid: ownerUid, name: "", ownerBusy: false, planType: "Basic" };
    try {
      const user = await User.findOne({ uid: ownerUid }).lean().catch(() => null);
      if (user) {
        ownerSnapshot = {
          uid: user.uid || ownerUid,
          name: user.name || user.fullName || "",
          mobile: user.mobile || user.phone || "",
          type: user.type || user.role || "",
          planType: user.planType || user.plan || "Basic",
          ownerBusy: !!user.ownerBusy,
        };
      }
    } catch {
      /* noop, keep minimal snapshot */
    }

    const now = new Date();
    const doc = await Business.create({
      name: String(name).trim(),
      category: req.body.category || "",
      subCategory: req.body.subCategory || "",
      description: req.body.description || "",
      services: Array.isArray(req.body.services) ? req.body.services : [],
      photos: Array.isArray(req.body.photos) ? req.body.photos : [],
      website: req.body.website || "",
      email: req.body.email || "",
      phone: req.body.phone || "",
      whatsapp: req.body.whatsapp || "",
      gstin: req.body.gstin || "",
      openingHours: req.body.openingHours || {},

      location: {
        type: "Point",
        coordinates: lngLat,
        address: addressPayload || null,
        visible,
        visibleChangedAt: now,
      },

      ownerUid,
      ownerSnapshot,
    });

    // Audit: create
    doc.recordAudit({ action: "create", actor: { uid: ownerUid, name: ownerSnapshot.name }, note: "initial upload" });
    await doc.save();

    const fresh = await Business.findById(doc._id).lean();
    return res.status(201).json({ isSuccess: true, data: normalizeBusiness(fresh) });
  } catch (err) {
    console.error("POST /business/upload error:", err);
    return res.status(500).json({ isSuccess: false, error: "UPLOAD_FAILED", errorDetail: err.message || String(err) });
  }
});

/* -------------------------------------------------------
 * GET /api/business/nearby
 * Query: lat, lng (required), distance(km=2 default), q (prefix on name),
 *        page, limit
 * Filters: visible=true, ownerSnapshot.ownerBusy != true
 * -----------------------------------------------------*/
router.get("/nearby", async (req, res) => {
  try {
    const { lat, lng, distance = 2, q = "", page = 1, limit = 50 } = req.query;
    if (typeof lat === "undefined" || typeof lng === "undefined") {
      return res.status(400).json({ isSuccess: false, error: "Missing lat/lng" });
    }
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res.status(400).json({ isSuccess: false, error: "Invalid lat/lng" });
    }

    const distNum = Number(distance);
    if (Number.isNaN(distNum) || distNum < 0) {
      return res.status(400).json({ isSuccess: false, error: "Invalid distance" });
    }
    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit || "50", 10)));
    const maxMeters = distNum > 0 ? distNum * 1000 : 0;

    const qTrim = String(q || "").trim();
    const nameRegex = qTrim
      ? { name: { $regex: "^" + qTrim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }
      : null;

    const buildPipeline = (applyName = false) => {
      const geoNear = {
        $geoNear: {
          near: { type: "Point", coordinates: [lngNum, latNum] },
          distanceField: "dist.calculated",
          spherical: true,
        },
      };
      if (maxMeters > 0) geoNear.$geoNear.maxDistance = maxMeters;

      const pipeline = [geoNear];
      pipeline.push({
        $match: { "location.visible": true, "ownerSnapshot.ownerBusy": { $ne: true }, isDeleted: { $ne: true } },
      });
      if (applyName && nameRegex) pipeline.push({ $match: nameRegex });
      pipeline.push({ $addFields: { distanceKm: { $divide: ["$dist.calculated", 1000] } } });
      pipeline.push({ $skip: (pageNum - 1) * limitNum });
      pipeline.push({ $limit: limitNum });
      pipeline.push({
        $project: {
          name: 1,
          category: 1,
          subCategory: 1,
          description: 1,
          services: 1,
          location: 1,
          ownerSnapshot: 1,
          ownerUid: 1,
          createdAt: 1,
          updatedAt: 1,
          distanceKm: 1,
          "dist.calculated": 1,
        },
      });
      return pipeline;
    };

    let results = [];
    let nameMatched = true;
    try {
      if (nameRegex) {
        const withName = await Business.aggregate(buildPipeline(true)).allowDiskUse(true);
        if (Array.isArray(withName) && withName.length) {
          results = withName;
          nameMatched = true;
        } else {
          const withoutName = await Business.aggregate(buildPipeline(false)).allowDiskUse(true);
          results = withoutName || [];
          nameMatched = false;
        }
      } else {
        results = await Business.aggregate(buildPipeline(false)).allowDiskUse(true);
        nameMatched = true;
      }
    } catch (aggErr) {
      // Fallback: $geoWithin + haversine
      console.warn("geoNear failed, fallback to geoWithin:", aggErr?.message || aggErr);
      const radiusInRadians = (distNum * 1000) / 6378137;
      const baseQuery = {
        location: { $geoWithin: { $centerSphere: [[lngNum, latNum], radiusInRadians] } },
        "location.visible": true,
        "ownerSnapshot.ownerBusy": { $ne: true },
        isDeleted: { $ne: true },
      };

      let docs = [];
      if (nameRegex) {
        docs = await Business.find({ $and: [baseQuery, nameRegex] }).lean().catch(() => []);
        if (!docs.length) {
          docs = await Business.find(baseQuery).lean().catch(() => []);
          nameMatched = false;
        } else nameMatched = true;
      } else {
        docs = await Business.find(baseQuery).lean().catch(() => []);
        nameMatched = true;
      }

      const toRad = (v) => (v * Math.PI) / 180;
      const haversineKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      const withDist = docs.map((d) => {
        const coords = Array.isArray(d.location?.coordinates) ? d.location.coordinates : null;
        let docLng = null, docLat = null;
        if (coords?.length >= 2) {
          docLng = coords[0];
          docLat = coords[1];
        }
        const distanceKm = (docLat != null && docLng != null) ? Number(haversineKm(latNum, lngNum, docLat, docLng)) : null;
        return { ...d, distanceKm };
      });

      withDist.sort((a, b) => {
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });

      const sliced = withDist.slice(0, limitNum);
      const normalized = sliced
        .filter((x) => x.distanceKm != null && x.distanceKm <= distNum)
        .map((x) => normalizeBusiness(x));
      return res.json({ isSuccess: true, page: pageNum, limit: limitNum, count: normalized.length, nameMatched, data: normalized });
    }

    const final = (results || []).filter((r) => {
      if (!r || !r.location) return false;
      if (r.location.visible !== true) return false;
      if (r.ownerSnapshot && r.ownerSnapshot.ownerBusy === true) return false;
      if (r.isDeleted === true) return false;
      return true;
    });

    const normalized = final
      .map((b) => normalizeBusiness(b))
      .filter((b) => b.distanceKm != null && b.distanceKm <= distNum);

    return res.json({ isSuccess: true, page: pageNum, limit: limitNum, count: normalized.length, nameMatched, data: normalized });
  } catch (err) {
    console.error("GET /business/nearby error:", err);
    return res.status(500).json({ isSuccess: false, error: "Server error: " + (err.message || "unknown") });
  }
});

/* -------------------------------------------------------
 * GET /api/business/
 * - If ownerUid equals requester => all (including invisible/soft-deleted? here only non-deleted)
 * - Else => only visible + not deleted
 * -----------------------------------------------------*/
router.get("/", async (req, res) => {
  try {
    const ownerUid = req.query?.ownerUid;
    const asUid = req.query?.asUid;
    const requesterUid = req.user ? (req.user.uid || (req.user._id ? String(req.user._id) : null)) : asUid;

    const ownerIsRequester = ownerUid && requesterUid && String(ownerUid) === String(requesterUid);

    const user = ownerUid ? await User.findOne({ uid: ownerUid }).lean().catch(() => null) : null;
    const baseFilter = user
      ? { $or: [{ owner: user._id }, { ownerUid: ownerUid }, { "ownerSnapshot.uid": ownerUid }] }
      : ownerUid
      ? { $or: [{ ownerUid: ownerUid }, { "ownerSnapshot.uid": ownerUid }] }
      : {};

    const visibilityGate = ownerIsRequester
      ? { isDeleted: { $ne: true } }
      : { "location.visible": true, isDeleted: { $ne: true } };

    const finalFilter = Object.keys(baseFilter).length ? { $and: [baseFilter, visibilityGate] } : visibilityGate;

    let q = Business.find(finalFilter).sort({ createdAt: -1 });
    if (Business.schema.path("owner")) q = q.populate("owner", "uid name mobile type planType");
    const docs = await q.lean();
    const normalized = docs.map(normalizeBusiness);
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("GET /business/ error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * GET /api/business/byUser/:uid
 * -----------------------------------------------------*/
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
      ? { $or: [{ owner: user._id }, { ownerUid: uid }, { "ownerSnapshot.uid": uid }] }
      : { $or: [{ ownerUid: uid }, { "ownerSnapshot.uid": uid }] };

    const visibilityGate = ownerIsRequester
      ? { isDeleted: { $ne: true } }
      : { "location.visible": true, isDeleted: { $ne: true } };

    const finalFilter = { $and: [baseFilter, visibilityGate] };

    let q = Business.find(finalFilter).sort({ createdAt: -1 });
    if (Business.schema.path("owner")) q = q.populate("owner", "uid name mobile type planType");
    const docs = await q.lean();
    const normalized = docs.map(normalizeBusiness);
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("GET /business/byUser/:uid error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * POST /api/business/bulk-insert
 * Body: array of business docs
 * -----------------------------------------------------*/
router.post("/bulk-insert", async (req, res) => {
  try {
    if (!Array.isArray(req.body)) return res.status(400).json({ isSuccess: false, error: "Data must be an array" });

    const docs = req.body.map((d) => {
      const copy = { ...d };
      copy.location = copy.location || {};
      if (typeof copy.location.visible === "undefined") copy.location.visible = true;
      if (!copy.location.visibleChangedAt) copy.location.visibleChangedAt = new Date();

      if (copy.location && copy.location.address) {
        copy.location.address = normalizeAddress(copy.location.address);
      } else if (copy.address) {
        copy.location.address = normalizeAddress(copy.address);
      }
      return copy;
    });

    const inserted = await Business.insertMany(docs);
    const normalized = inserted.map((i) => normalizeBusiness(i.toObject ? i.toObject() : i));
    return res.json({ isSuccess: true, count: normalized.length, data: normalized });
  } catch (err) {
    console.error("POST /business/bulk-insert error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * PATCH /api/business/:id
 * Accepts: name, category, subCategory, description, services, photos,
 * phone, whatsapp, email, website, gstin, openingHours,
 * visible, coords or location:{coordinates/address/visible}, address
 * (Uses audit trail + updateLocation helper when location passed)
 * -----------------------------------------------------*/
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Business.findById(id);
    if (!existing) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    if (!isOwner(req, existing)) return res.status(403).json({ isSuccess: false, error: "FORBIDDEN" });

    const actor = {
      uid: (req.user && (req.user.uid || (req.user._id ? String(req.user._id) : undefined))) || (req.query?.ownerUid || req.body?.ownerUid),
      name: req.user?.name || "",
    };

    const changes = [];
    const fields = [
      "name", "category", "subCategory", "description", "services", "photos",
      "phone", "whatsapp", "email", "website", "gstin", "openingHours"
    ];

    fields.forEach((f) => {
      if (typeof req.body[f] !== "undefined") {
        const oldVal = existing[f];
        const newVal = req.body[f];
        const changed =
          Array.isArray(newVal) || Array.isArray(oldVal)
            ? JSON.stringify(oldVal || []) !== JSON.stringify(newVal || [])
            : String(oldVal ?? "") !== String(newVal ?? "");
        if (changed) {
          existing[f] = newVal;
          changes.push({ field: f, from: oldVal, to: newVal });
        }
      }
    });

    // visible +/or location update
    let locationPayload = null;

    // coords shorthand support
    if (req.body.coords) {
      const c = req.body.coords;
      let lat = null, lng = null;
      if (typeof c === "string") {
        const parts = c.split(",").map((s) => s.trim());
        if (parts.length >= 2) { lat = parseFloat(parts[0]); lng = parseFloat(parts[1]); }
      } else if (typeof c === "object" && (c.lat !== undefined && c.lng !== undefined)) {
        lat = Number(c.lat); lng = Number(c.lng);
      } else if (Array.isArray(c) && c.length >= 2) {
        lat = Number(c[0]); lng = Number(c[1]);
      }
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        locationPayload = { ...(locationPayload || {}), coordinates: [lng, lat] };
      }
    }

    // full location object
    if (req.body.location) {
      const loc = req.body.location;
      if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
        const lng = Number(loc.coordinates[0]);
        const lat = Number(loc.coordinates[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          locationPayload = { ...(locationPayload || {}), coordinates: [lng, lat] };
        }
      }
      if (Object.prototype.hasOwnProperty.call(loc, "visible")) {
        locationPayload = { ...(locationPayload || {}), visible: !!loc.visible };
      }
      if (Object.prototype.hasOwnProperty.call(loc, "address")) {
        locationPayload = {
          ...(locationPayload || {}),
          address: loc.address === null ? null : normalizeAddress(loc.address),
        };
      }
    }

    // address at top-level
    if (Object.prototype.hasOwnProperty.call(req.body, "address")) {
      locationPayload = {
        ...(locationPayload || {}),
        address: req.body.address === null ? null : normalizeAddress(req.body.address),
      };
    }

    // visible at top-level
    if (typeof req.body.visible !== "undefined" && locationPayload?.visible === undefined) {
      locationPayload = { ...(locationPayload || {}), visible: !!req.body.visible };
    }

    // Apply location changes via helper (audit included)
    if (locationPayload) {
      await existing.updateLocation(locationPayload, actor, "API: location update via PATCH");
    }

    // record update audit for non-location fields
    if (changes.length) {
      existing.recordAudit({ action: "update", actor, changes });
    }

    await existing.save();
    const fresh = await Business.findById(id).lean();
    return res.json({ isSuccess: true, data: normalizeBusiness(fresh) });
  } catch (err) {
    console.error("PATCH /business/:id error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * DELETE /api/business/:id   (Soft delete)
 * -----------------------------------------------------*/
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Business.findById(id);
    if (!existing) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    if (!isOwner(req, existing)) return res.status(403).json({ isSuccess: false, error: "FORBIDDEN" });

    const actor = {
      uid: (req.user && (req.user.uid || (req.user._id ? String(req.user._id) : undefined))) || (req.query?.ownerUid || req.body?.ownerUid),
      name: req.user?.name || "",
    };

    await existing.softDelete(actor, req.body.note || "soft delete via API");
    const fresh = await Business.findById(id).lean();
    return res.json({ isSuccess: true, data: normalizeBusiness(fresh) });
  } catch (err) {
    console.error("DELETE /business/:id error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * POST /api/business/:id/restore   (Restore soft-deleted)
 * -----------------------------------------------------*/
router.post("/:id/restore", async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Business.findById(id);
    if (!existing) return res.status(404).json({ isSuccess: false, error: "NOT_FOUND" });

    if (!isOwner(req, existing)) return res.status(403).json({ isSuccess: false, error: "FORBIDDEN" });

    const actor = {
      uid: (req.user && (req.user.uid || (req.user._id ? String(req.user._id) : undefined))) || (req.query?.ownerUid || req.body?.ownerUid),
      name: req.user?.name || "",
    };

    await existing.restore(actor, req.body.note || "restore via API");
    const fresh = await Business.findById(id).lean();
    return res.json({ isSuccess: true, data: normalizeBusiness(fresh) });
  } catch (err) {
    console.error("POST /business/:id/restore error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * POST /api/business/:id/review   (Add review + recompute)
 * Body: { reviewerId, reviewerName?, rating(1..5), comment? }
 * -----------------------------------------------------*/
router.post("/:id/review", async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewerId, reviewerName = "", rating, comment = "" } = req.body;

    if (!id || !reviewerId || rating == null) {
      return res.status(400).json({ isSuccess: false, error: "MISSING_PARAMS" });
    }

    const numRating = Number(rating);
    if (!Number.isFinite(numRating) || numRating < 1 || numRating > 5) {
      return res.status(400).json({ isSuccess: false, error: "RATING_MUST_BE_1_TO_5" });
    }

    const exists = await Business.exists({ _id: id });
    if (!exists) return res.status(404).json({ isSuccess: false, error: "BUSINESS_NOT_FOUND" });

    const reviewObj = {
      reviewerId: String(reviewerId),
      reviewerName: String(reviewerName || "").trim(),
      rating: numRating,
      comment: String(comment || "").trim(),
      createdAt: new Date(),
      visible: true,
    };

    const pipeline = [
      { $set: { reviews: { $concatArrays: [{ $ifNull: ["$reviews", []] }, [reviewObj]] } } },
      {
        $set: {
          visibleReviews: {
            $filter: { input: { $ifNull: ["$reviews", []] }, as: "r", cond: { $eq: ["$$r.visible", true] } },
          },
        },
      },
      {
        $set: {
          reviewCount: { $size: "$visibleReviews" },
          totalRating: { $sum: { $map: { input: "$visibleReviews", as: "r", in: "$$r.rating" } } },
        },
      },
      {
        $set: {
          avgRating: {
            $cond: [{ $gt: ["$reviewCount", 0] }, { $round: [{ $divide: ["$totalRating", "$reviewCount"] }, 2] }, 0],
          },
        },
      },
      { $unset: ["visibleReviews"] },
    ];

    const updated = await Business.findByIdAndUpdate(id, pipeline, { new: true }).lean();
    if (!updated) return res.status(404).json({ isSuccess: false, error: "BUSINESS_NOT_FOUND" });

    const added = Array.isArray(updated.reviews) ? updated.reviews[updated.reviews.length - 1] : null;
    return res.json({
      isSuccess: true,
      data: { review: added, reviewCount: updated.reviewCount || 0, avgRating: updated.avgRating || 0 },
    });
  } catch (err) {
    console.error("POST /business/:id/review error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

/* -------------------------------------------------------
 * GET /api/business/:id/reviews  (Paginated visible reviews)
 * -----------------------------------------------------*/
router.get("/:id/reviews", async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || "20", 10)));
    const sortOrder = req.query.sort === "asc" ? 1 : -1;

    const biz = await Business.findById(id).select("reviews reviewCount avgRating").lean();
    if (!biz) return res.status(404).json({ isSuccess: false, error: "BUSINESS_NOT_FOUND" });

    const visible = Array.isArray(biz.reviews) ? biz.reviews.filter((r) => r && r.visible) : [];
    visible.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (sortOrder === -1) visible.reverse();

    const total = visible.length;
    const start = (page - 1) * limit;
    const pageSlice = visible.slice(start, start + limit);

    return res.json({
      isSuccess: true,
      data: { total, page, limit, reviews: pageSlice, reviewCount: biz.reviewCount || total, avgRating: biz.avgRating || 0 },
    });
  } catch (err) {
    console.error("GET /business/:id/reviews error:", err);
    return res.status(500).json({ isSuccess: false, error: err.message || "Server error" });
  }
});

export default router;
