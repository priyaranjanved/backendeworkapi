import Aadhaar from "../models/Aadhaar.js";

// ✅ Verify Aadhaar
export const verifyAadhaar = async (req, res) => {
  try {
    const { aadhaarNumber } = req.body;
    const record = await Aadhaar.findOne({ aadhaar_number: aadhaarNumber });

    if (record) {
      return res.json({ isSuccess: true, data: record });
    } else {
      return res.json({ isSuccess: false, error: "Aadhaar is not verified" });
    }
  } catch (error) {
    res.status(500).json({ isSuccess: false, error: error.message });
  }
};

// ✅ Login with Aadhaar
export const loginWithAadhaar = async (req, res) => {
  try {
    const { aadhaarNumber, password } = req.body;
    const user = await Aadhaar.findOne({ aadhaar_number: aadhaarNumber });

    if (!user || !user.verified) {
      return res.status(401).json({ isSuccess: false, error: "Aadhaar not verified" });
    }

    if (password !== "test123") {
      return res.status(401).json({ isSuccess: false, error: "Invalid password" });
    }

    res.json({ isSuccess: true, message: "Login successful", data: user });
  } catch (error) {
    res.status(500).json({ isSuccess: false, error: error.message });
  }
};

// ✅ Bulk Insert Aadhaar Dummy Data
export const insertBulkAadhaar = async (req, res) => {
  try {
    const data = req.body; 
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(400).json({ isSuccess: false, error: "Send an array of Aadhaar records" });
    }

    const result = await Aadhaar.insertMany(data, { ordered: false });
    res.json({ isSuccess: true, insertedCount: result.length, data: result });
  } catch (error) {
    res.status(500).json({ isSuccess: false, error: error.message });
  }
};
