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

// ── Customer route limiting: TWO tiers, because the risk is different ──
//
// Tier 1 (tight) — /api/customer/lookup only. This is the endpoint an
// attacker abuses to harvest names by scripting through phone numbers.
// A real diner types their phone once or twice per visit, so 20 tries
// per 5 minutes is generous for humans and useless for scripts.
const lookupLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many lookups. Please wait a few minutes and try again.' }
});

// Tier 2 (loose) — everything else under /api/customer. The menu page
// polls the profile every 10s (~30 req/5min per open customer), and a
// whole restaurant's diners share ONE WiFi IP. 1000 per 5 min supports
// ~30 customers browsing simultaneously on the same network while still
// capping runaway scripts and infinite loops.
const customerLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait a few minutes.' }
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
// The tight lookup limiter must be registered on the specific path FIRST,
// then the loose limiter guards the rest of the customer routes.
app.use('/api/customer/lookup', lookupLimiter);
app.use('/api/customer', customerLimiter, require('./routes/customer'));
app.use('/api/auth', authLimiter, require('./routes/auth'));
app.use('/api/restaurant', require('./routes/restaurant'));
app.use('/api/menu', require('./routes/menu'));
// Tight limit ONLY on order creation + payment verification (the abusable
// actions). Status polling and bill downloads under /api/orders stay on the
// loose customer-tier limit so a table refreshing status never gets blocked.
app.use('/api/orders/create', orderLimiter);
app.use('/api/orders/verify-payment', orderLimiter);
app.use('/api/orders', customerLimiter, require('./routes/order'));
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
  // Full detail stays in server logs only — clients get a generic message so
  // internal wording (driver errors, file paths) can never leak outward.
  console.error('❌ Error:', err);
  const safeMessage = err.status && err.status < 500 && err.message
    ? err.message                      // deliberate 4xx messages (e.g. CORS) are fine
    : 'Internal Server Error';
  res.status(err.status || 500).json({ success: false, message: safeMessage });
});

module.exports = app;
