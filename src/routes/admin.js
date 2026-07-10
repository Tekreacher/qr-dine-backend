const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const Restaurant = require('../models/Restaurant');

// Middleware to protect admin routes
const protectAdmin = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(401).json({ success: false, message: 'Not admin' });
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// @route POST /api/admin/setup
// @desc  Create admin account (run once)
router.post('/setup', async (req, res) => {
  try {
    const existing = await Admin.findOne({});
    if (existing) return res.status(400).json({ success: false, message: 'Admin already exists' });
    const admin = await Admin.create({ email: req.body.email, password: req.body.password, name: req.body.name || 'Super Admin' });
    res.json({ success: true, message: 'Admin created' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin || !(await admin.matchPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
    const token = jwt.sign({ id: admin._id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({ success: true, token, admin: { name: admin.name, email: admin.email } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route GET /api/admin/restaurants
// @desc  Get all restaurants with their status
router.get('/restaurants', protectAdmin, async (req, res) => {
  try {
    const restaurants = await Restaurant.find({}).select('-password -menuItems -qrCode -allQrCodes');
    res.json({ success: true, restaurants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route PUT /api/admin/restaurants/:id/approve
router.put('/restaurants/:id/approve', protectAdmin, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, message: 'Not found' });
    restaurant.isApproved = true;
    restaurant.isActive = true;
    // Set subscription for 30 days from approval
    restaurant.subscriptionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    restaurant.subscriptionStatus = 'active';
    await restaurant.save();
    res.json({ success: true, message: 'Restaurant approved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route PUT /api/admin/restaurants/:id/reject
router.put('/restaurants/:id/reject', protectAdmin, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, message: 'Not found' });
    restaurant.isApproved = false;
    restaurant.isActive = false;
    restaurant.subscriptionStatus = 'rejected';
    await restaurant.save();
    res.json({ success: true, message: 'Restaurant rejected' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route PUT /api/admin/restaurants/:id/toggle
// @desc  Enable or disable a restaurant
router.put('/restaurants/:id/toggle', protectAdmin, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, message: 'Not found' });
    restaurant.isActive = !restaurant.isActive;
    await restaurant.save();
    res.json({ success: true, message: restaurant.isActive ? 'Restaurant enabled' : 'Restaurant disabled', isActive: restaurant.isActive });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// @route PUT /api/admin/restaurants/:id/renew
// @desc  Renew subscription for 30 more days
router.put('/restaurants/:id/renew', protectAdmin, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.params.id);
    if (!restaurant) return res.status(404).json({ success: false, message: 'Not found' });
    const base = restaurant.subscriptionExpiry > new Date() ? restaurant.subscriptionExpiry : new Date();
    restaurant.subscriptionExpiry = new Date(base.getTime() + 30 * 24 * 60 * 60 * 1000);
    restaurant.subscriptionStatus = 'active';
    restaurant.isActive = true;
    await restaurant.save();
    res.json({ success: true, message: 'Subscription renewed for 30 days' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
