import dotenv from "dotenv";
import app from "./app.js";
import connectDB from "./config/db.js";

dotenv.config();

// Connect MongoDB
connectDB();

const PORT = process.env.PORT || 8080;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running on http://192.168.31.162:${PORT}`);
  // console.log(`✅ Server running on http://192.168.29.90:8080:${PORT}`);
});
// app.listen(PORT, () => {
//   console.log(`✅ Server running on http://localhost:${PORT}`);
// });
