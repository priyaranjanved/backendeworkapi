import mongoose from "mongoose";

const FacePhotoSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },

    // ✅ URL optional (kyunki ab base64 bhi store hoga)
    url: { type: String, required: false, default: null },

    // ✅ NEW: business jaisa base64 data url
    // Example: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
    data: { type: String, required: false, default: null },
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

    // ✅ FacePhoto required but inside fields can be url OR data
    facePhoto: {
      type: FacePhotoSchema,
      required: true,
      validate: {
        validator: function (v) {
          // ✅ url ya data me se koi ek hona chahiye
          return !!(v && (v.url || v.data));
        },
        message: "facePhoto must contain either url or data",
      },
    },
  },
  { timestamps: true }
);

const KycCardUser = mongoose.model("KycCardUser", KycCardUserSchema);

export default KycCardUser;
