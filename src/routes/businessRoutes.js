// src/routes/businessRoutes.js
import express from "express";
import upload from "../middleware/upload.js";
import Business from "../models/business.js";
import {
  createBusiness,
  getBusinessesByUser,
  getBusiness,
  getNearbyBusinesses
} from "../controllers/business.controller.js";

const router = express.Router();

// --------- NEARBY BUSINESS (GET) ---------
router.get("/nearby", async (req, res) => {
  try {
    const {
      lat,
      lng,
      distance = 2,           // km
      q = "",                 // search text (business name)
      page = 1,
      limit = 50,
    } = req.query;

    if (typeof lat === "undefined" || typeof lng === "undefined") {
      return res
        .status(400)
        .json({ isSuccess: false, error: "Missing required query param: lat and lng" });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (Number.isNaN(latNum) || Number.isNaN(lngNum)) {
      return res
        .status(400)
        .json({ isSuccess: false, error: "Invalid lat/lng" });
    }

    const distNum = Number(distance); // kilometre
    if (Number.isNaN(distNum) || distNum < 0) {
      return res
        .status(400)
        .json({ isSuccess: false, error: "Invalid distance" });
    }

    const pageNum = Math.max(1, parseInt(page || "1", 10));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit || "50", 10)));

    const maxMeters = distNum > 0 ? distNum * 1000 : 0;

    // search term (q / businessName)
    const searchText = String(q || req.query.businessName || "").trim();

    const safeBusinessRegex = searchText
      ? {
          businessName: {
            $regex:
              "^" + searchText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        }
      : null;

    // normalize helper -> client friendly
    const normalizeBusiness = (b) => {
      const distanceKm =
        b.distanceKm != null
          ? Number(b.distanceKm)
          : b.dist && b.dist.calculated
          ? Number(b.dist.calculated) / 1000
          : null;

      return {
        _id: b._id,
        businessName: b.businessName,
        name: b.businessName,                 // front-end convenience
        businessDescription: b.businessDescription,
        description: b.businessDescription,   // same as above
        location: b.location,
        images: b.images || [],
        poster: b.poster || { uid: b.postedByUid || "" },
        postedByUid: b.postedByUid,
        postedBy: b.postedBy,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        distanceKm,
      };
    };

    const buildPipeline = (applySearch = false) => {
      const geoNear = {
        $geoNear: {
          near: { type: "Point", coordinates: [lngNum, latNum] }, // NOTE: [lng, lat]
          distanceField: "dist.calculated",
          spherical: true,
        },
      };

      if (maxMeters > 0) geoNear.$geoNear.maxDistance = maxMeters;

      const pipeline = [geoNear];

      // only visible + not busy (same logic as work)
      pipeline.push({
        $match: {
          "location.visible": { $ne: false }, // default true
          "poster.posterBusy": { $ne: true },
        },
      });

      if (applySearch && safeBusinessRegex) {
        pipeline.push({ $match: safeBusinessRegex });
      }

      pipeline.push({
        $addFields: {
          distanceKm: { $divide: ["$dist.calculated", 1000] },
        },
      });

      pipeline.push({ $skip: (pageNum - 1) * limitNum });
      pipeline.push({ $limit: limitNum });

      pipeline.push({
        $project: {
          businessName: 1,
          businessDescription: 1,
          location: 1,
          images: 1,
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
    let nameMatched = true;

    try {
      if (safeBusinessRegex) {
        const withName = await Business.aggregate(
          buildPipeline(true)
        ).allowDiskUse(true);

        if (Array.isArray(withName) && withName.length > 0) {
          results = withName;
          nameMatched = true;
        } else {
          const withoutName = await Business.aggregate(
            buildPipeline(false)
          ).allowDiskUse(true);
          results = withoutName || [];
          nameMatched = false;
        }
      } else {
        results = await Business.aggregate(buildPipeline(false)).allowDiskUse(true);
        nameMatched = true;
      }
    } catch (aggErr) {
      // fallback agar $geoNear fail kare
      console.warn(
        "Business geoNear failed, falling back to geoWithin. Error:",
        aggErr?.message || aggErr
      );

      const radiusInRadians =
        maxMeters > 0 ? maxMeters / 6378137 : (distNum * 1000) / 6378137;

      const baseQuery = {
        location: {
          $geoWithin: { $centerSphere: [[lngNum, latNum], radiusInRadians] },
        },
        "location.visible": { $ne: false },
        "poster.posterBusy": { $ne: true },
      };

      let docs = [];

      if (safeBusinessRegex) {
        docs = await Business.find({
          $and: [baseQuery, safeBusinessRegex],
        })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean()
          .catch(() => []);

        if (docs.length === 0) {
          docs = await Business.find(baseQuery)
            .skip((pageNum - 1) * limitNum)
            .limit(limitNum)
            .lean()
            .catch(() => []);
          nameMatched = false;
        } else {
          nameMatched = true;
        }
      } else {
        docs = await Business.find(baseQuery)
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean()
          .catch(() => []);
        nameMatched = true;
      }

      const toRad = (v) => (v * Math.PI) / 180;
      const haversineKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(toRad(lat1)) *
            Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      const docsWithDistances = docs.map((d) => {
        const coords = Array.isArray(d.location?.coordinates)
          ? d.location.coordinates
          : null;
        let docLng = null,
          docLat = null;
        if (coords && coords.length >= 2) {
          docLng = coords[0];
          docLat = coords[1];
        }
        const distanceKm =
          docLat != null && docLng != null
            ? Number(haversineKm(latNum, lngNum, docLat, docLng))
            : null;

        return { ...d, distanceKm };
      });

      docsWithDistances.sort((a, b) => {
        if (a.distanceKm == null) return 1;
        if (b.distanceKm == null) return -1;
        return a.distanceKm - b.distanceKm;
      });

      const sliced = docsWithDistances.slice(0, limitNum);
      const normalized = sliced
        .map((b) => normalizeBusiness(b))
        .filter(
          (b) => b.distanceKm != null && b.distanceKm <= distNum
        );

      return res.json({
        isSuccess: true,
        page: pageNum,
        limit: limitNum,
        count: normalized.length,
        nameMatched,
        data: normalized,
      });
    }

    // final filter + normalize (geoNear path)
    const final = (results || []).filter((r) => {
      if (!r || !r.location) return false;
      if (r.location.visible === false) return false;
      if (r.poster && r.poster.posterBusy === true) return false;
      return true;
    });

    const normalized = final
      .map((b) => normalizeBusiness(b))
      .filter(
        (b) => b.distanceKm != null && b.distanceKm <= distNum
      );

    return res.json({
      isSuccess: true,
      page: pageNum,
      limit: limitNum,
      count: normalized.length,
      nameMatched,
      data: normalized,
    });
  } catch (err) {
    console.error("GET /api/business/nearby error:", err);
    return res
      .status(500)
      .json({ isSuccess: false, error: "Server error: " + (err.message || "unknown") });
  }
});

// --------- existing routes ---------
// router.post("/", upload.array("images", 5), createBusiness);
// router.get("/user", getBusinessesByUser);
// router.get("/nearby", getNearbyBusinesses);
// router.get("/:id", getBusiness);
// NEW: nearby


router.post("/", createBusiness);

// router.post(
//   "/",
//   upload.array("images", 5),
//   (req, res, next) => {
//     console.log("=== CREATE BUSINESS REQUEST (ROUTE) ===");
//     console.log("BODY:", req.body);
//     console.log(
//       "FILES:",
//       (req.files || []).map((f) => ({
//         field: f.fieldname,
//         originalname: f.originalname,
//         filename: f.filename,
//         mimetype: f.mimetype,
//       }))
//     );
//     console.log("=======================================");
//     next();
//   },
//   createBusiness
// );


// ✅ Get businesses by user
router.get("/user", getBusinessesByUser);

// ✅ Get nearby businesses
router.get("/nearby", getNearbyBusinesses);

// ✅ Get single business
router.get("/:id", getBusiness);


export default router;
