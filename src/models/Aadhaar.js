import mongoose from "mongoose";

const AadhaarSchema = new mongoose.Schema({
  aadhaar_number: { type: String, required: true, unique: true },
  name: String,
  dob: String,
  gender: String,
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String,
  },
  phone: String,
  verified: { type: Boolean, default: false }
}, { timestamps: true });

// ✅ Export as default
const Aadhaar = mongoose.model("Aadhaar", AadhaarSchema);
export default Aadhaar;
