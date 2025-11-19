// src/controllers/workController.js
import Work from "../models/work.js";
import User from "../models/user.js"; // adjust path

const toLngLat = (coords) => {
  let lat = null, lng = null;
  if (typeof coords === "string") {
    const [a, b] = coords.split(",").map(s => s.trim());
    lat = parseFloat(a); lng = parseFloat(b);
  } else if (Array.isArray(coords)) {
    lat = parseFloat(coords[0]); lng = parseFloat(coords[1]);
  }
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return [lng, lat];
};

export const createWork = async (req, res) => {
  try {
    const { workName, description, coords, posterUid } = req.body;
    if (!workName || !coords || !posterUid) {
      return res.status(400).json({ isSuccess: false, error: "Missing fields (workName, coords, posterUid required)" });
    }

    const lnglat = toLngLat(coords);
    if (!lnglat) {
      return res.status(400).json({ isSuccess: false, error: "Invalid coordinates format. Use 'lat, lng'." });
    }

    // Find user by UID to snapshot
    const user = await User.findOne({ uid: posterUid }).lean();
    if (!user) {
      return res.status(404).json({ isSuccess: false, error: "User not found for given posterUid" });
    }

    const posterSnapshot = {
      uid: user.uid,
      name: user.name || "",
      age: user.age ?? null,
      mobile: user.mobile || "",
      gender: user.gender || "Other",
      planType: user.planType || "Basic",
    };

    const created = await Work.create({
      name: workName,
      description: description || "",
      location: { type: "Point", coordinates: lnglat },
      postedByUid: user.uid,
      posterSnapshot,
    });

    return res.status(201).json({ isSuccess: true, data: created });
  } catch (err) {
    console.error("createWork error:", err);
    return res.status(500).json({ isSuccess: false, error: "Server error" });
  }
};

export const listWorks = async (req, res) => {
  try {
    // You can add filters here if you want (e.g., near coords)
    const works = await Work.find({}).sort({ createdAt: -1 }).lean();
    return res.json({ isSuccess: true, data: works });
  } catch (err) {
    console.error("listWorks error:", err);
    return res.status(500).json({ isSuccess: false, error: "Server error" });
  }
};
