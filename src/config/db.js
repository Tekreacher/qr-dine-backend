const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI);
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error("========== FULL ERROR ==========");
    console.error(error);
    console.error("Name:", error.name);
    console.error("Message:", error.message);
    console.error("Cause:", error.cause);
    process.exit(1);
  }
};

module.exports = connectDB;