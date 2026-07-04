require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();

/* ===============================
   MIDDLEWARE
================================ */

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.options('*', cors());

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static uploads
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

/* ===============================
   ROUTES
================================ */

app.use('/api/customer', require('./routes/customer'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/restaurant', require('./routes/restaurant'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/order'));
app.use('/api/admin/orders', require('./routes/orderAdmin'));
app.use('/api/order-status', require('./routes/orderStatus'));
app.use('/api/webhook', require('./routes/webhook'));

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