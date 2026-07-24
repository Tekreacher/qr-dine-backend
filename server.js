const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
// Render's outbound network cannot reach IPv6. Prefer IPv4 for every outbound
// connection made through Node's dns.lookup() (MongoDB, Cloudinary, Razorpay,
// etc.). Note: Nodemailer does its own DNS internally and ignores this, which is
// why emailService.js resolves the SMTP IPv4 address itself.
if (typeof dns.setDefaultResultOrder === 'function') {
  dns.setDefaultResultOrder('ipv4first');
}

require('dotenv').config(); // MUST be first

const app = require('./src/app');
const connectDB = require('./src/config/db');

const PORT = process.env.PORT || 5000;

/* ===============================
   ENV DEBUG (SAFE)
================================ */
console.log('🔍 Environment check');
console.log('PORT:', PORT);
console.log('NODE_ENV:', process.env.NODE_ENV || 'development');
console.log(
  'MONGODB_URI:',
  process.env.MONGODB_URI ? 'Loaded ✓' : 'Missing ✗'
);

/* ===============================
   DATABASE
================================ */
connectDB();

/* ===============================
   SERVER START
================================ */
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `🚀 Server running on port ${PORT} in ${process.env.NODE_ENV || 'development'} mode`
  );
});

/* ===============================
   ERROR SAFETY (IMPORTANT)
================================ */

// Catch async promise crashes (DB, Razorpay, etc.)
process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err);
  server.close(() => process.exit(1));
});

// Catch Railway container crashes
process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received. Shutting down gracefully...');
  server.close(() => process.exit(0));
});
