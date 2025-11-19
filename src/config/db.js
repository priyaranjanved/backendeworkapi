// import mongoose from "mongoose";

// const connectDB = async () => {
//   try {
//     const conn = await mongoose.connect(process.env.MONGO_URI);
//     console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
//   } catch (error) {
//     console.error(`❌ Error: ${error.message}`);
//     process.exit(1);
//   }
// };

// export default connectDB;

// config/db.js
import mongoose from "mongoose";

const connectDB = async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error("❌ MONGO_URI not defined in .env");
    return;
  }

  try {
    await mongoose.connect(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      // useCreateIndex: true, // mongoose v6+ में optional
      // useFindAndModify: false,
    });
    console.log("✅ MongoDB Connected Successfully");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message || err);
    // don't exit process — keep server running so you can inspect logs and fix .env
  }

  // optional: print readyState every 5s to monitor
  setInterval(() => {
    console.log("Mongoose readyState:", mongoose.connection.readyState);
  }, 100000);
};

export default connectDB;
