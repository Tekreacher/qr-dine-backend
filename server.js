const dns = require('dns');
dns.setServers(['8.8.8.8', '1.1.1.1']);
// Render's outbound network can't reach IPv6 addresses. By default, Node may
// still resolve hosts (like smtp.gmail.com) to an IPv6 address first, causing
// ENETUNREACH. This forces IPv4 to be tried first for ALL outbound connections
// app-wide (email, APIs, etc.) — the reliable fix for this exact Render issue.
dns.setDefaultResultOrder('ipv4first');

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
