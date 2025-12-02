import AppConfig from "../models/appConfig.js";

// GET - All map icons
export const getMapIcons = async (req, res) => {
  try {
    const doc = await AppConfig.findOne({ type: "mapIcons" }).lean();

    if (!doc) {
      return res.status(200).json({
        isSuccess: true,
        data: {
          workerIcon: null,
          centerUserIcon: null,
          businessIcon: null,
          skillIcon: null
        },
      });
    }

    return res.status(200).json({
      isSuccess: true,
      data: {
        workerIcon: doc.workerIcon,
        centerUserIcon: doc.centerUserIcon,
        businessIcon: doc.businessIcon,
        skillIcon: doc.skillIcon
      }
    });
  } catch (err) {
    console.error("GET map-icons error:", err);
    res.status(500).json({ isSuccess: false, error: err.message });
  }
};

// POST - Insert or Update map icons (Upsert)
export const upsertMapIcons = async (req, res) => {
  try {
    const {
      workerIcon,
      centerUserIcon,
      businessIcon,
      skillIcon,
    } = req.body;

    const updated = await AppConfig.findOneAndUpdate(
      { type: "mapIcons" },
      {
        $set: {
          workerIcon,
          centerUserIcon,
          businessIcon,
          skillIcon,
        },
      },
      { new: true, upsert: true }
    );

    res.status(200).json({ isSuccess: true, data: updated });
  } catch (err) {
    console.error("POST map-icons error:", err);
    res.status(500).json({ isSuccess: false, error: err.message });
  }
};
