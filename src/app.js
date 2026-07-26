require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const app = express();

/* ===============================
   TRUST PROXY (Render/Railway sit behind a proxy — needed for correct
   client IPs in rate limiting and secure cookies)
================================ */
app.set('trust proxy', 1);

/* ===============================
   SECURITY HEADERS
================================ */
app.use(helmet({
  // Menu images / QR codes are served cross-origin to the frontend,
  // so don't let helmet's default CORP block them.
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

/* ===============================
   CORS — locked to known frontend origins only.
   Set FRONTEND_URL in .env, comma-separated if you have more than one
   (e.g. your Vercel prod domain + a preview domain):
   FRONTEND_URL=https://qr-dine-frontend-three.vercel.app,https://yourdomain.com
================================ */
const allowedOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin requests (curl, server-to-server, Razorpay webhooks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.warn('⛔ Blocked CORS request from origin:', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

/* ===============================
   RATE LIMITING
   Keep these generous enough that a busy restaurant floor never hits
   them during normal use — they exist to stop brute-force / scraping,
   not to throttle real customers.
================================ */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,   // 15 minutes
  max: 20,                     // 20 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' }
});

const orderLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,    // 5 minutes
  max: 30,                     // generous — a table can reorder a few times
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many orders from this device. Please wait a few minutes.' }
});

/* ===============================
   WEBHOOK — MUST BE MOUNTED BEFORE express.json()
================================ */
// ⚠️ CRITICAL ORDERING: the Razorpay webhook route verifies a signature
// against the exact raw request bytes. If the global express.json()
// middleware runs first, it consumes and re-parses the body stream into a
// JS object — by the time webhook.js's own express.raw() middleware runs,
// there are no raw bytes left to sign-check, so EVERY webhook signature
// verification would silently fail (or worse, silently pass on an empty
// buffer). Mounting it here, before express.json(), guarantees Razorpay's
// webhook requests never touch the JSON parser at all.
app.use('/api/webhook', require('./routes/webhook'));

/* ===============================
   MIDDLEWARE (everything else can use parsed JSON)
================================ */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

/* ===============================
   ROUTES
================================ */
app.use('/api/customer', require('./routes/customer'));
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/restaurant', require('./routes/restaurant'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', orderLimiter, require('./routes/order'));
app.use('/api/admin/orders', require('./routes/orderAdmin'));
app.use('/api/order-status', require('./routes/orderStatus'));
app.use('/api/admin', authLimiter, require('./routes/admin'));

/* ===============================
   HEALTH CHECK
================================ */
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

/* ===============================
   ERROR HANDLER
================================ */
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error'
  });
});

module.exports = app;
