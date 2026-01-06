import mongoose from "mongoose";

const FacePhotoSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    url: { type: String, required: true },
  },
  { _id: false }
);

const KycCardUserSchema = new mongoose.Schema(
  {
    uid: { type: String, required: true, unique: true, index: true },
    fullName: { type: String, required: true, trim: true },
    mobile: { type: String, required: true, unique: true, index: true },
    dob: { type: Date, required: true },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, required: true, enum: ["male", "female", "other"] },
    planType: { type: String, default: "Basic", enum: ["Basic", "Premium"] },
    facePhoto: { type: FacePhotoSchema, required: true },
  },
  { timestamps: true }
);

const KycCardUser = mongoose.model("KycCardUser", KycCardUserSchema);

export default KycCardUser;
