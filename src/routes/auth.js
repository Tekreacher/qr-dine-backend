const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const Restaurant = require('../models/Restaurant');

const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// @route   POST /api/auth/register
// @desc    Register a new restaurant (creates PENDING account - no token returned)
// @access  Public
router.post('/register', [
  body('name').notEmpty().withMessage('Restaurant name is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('phone').notEmpty().withMessage('Phone number is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { name, email, password, phone, address, ownerName, ownerPhone } = req.body;

    // Check if restaurant already exists
    const existingRestaurant = await Restaurant.findOne({ email });
    if (existingRestaurant) {
      return res.status(400).json({
        success: false,
        message: 'A restaurant with this email already exists. Please login instead.'
      });
    }

    // Create restaurant with PENDING status — no token returned
    const restaurant = await Restaurant.create({
      name,
      email,
      password,
      ownerName: ownerName || name,
      ownerPhone: ownerPhone || phone || '',
      phone,
      address,
      isApproved: false,
      isActive: false,
      subscriptionStatus: 'pending'
    });

    // Return success but NO token — they cannot login until approved
    res.status(201).json({
      success: true,
      pending: true,
      message: 'Registration successful! Your account is pending admin approval. You will be able to login once approved.'
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login restaurant
// @access  Public
router.post('/login', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find restaurant with password
    const restaurant = await Restaurant.findOne({ email }).select('+password');
    if (!restaurant) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    // Check approval status BEFORE password
    if (!restaurant.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. Please wait for approval before logging in.',
        status: 'pending'
      });
    }

    if (!restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact the admin.',
        status: 'disabled'
      });
    }

    // Check subscription expiry
    if (restaurant.subscriptionExpiry && restaurant.subscriptionExpiry < new Date()) {
      restaurant.subscriptionStatus = 'expired';
      restaurant.isActive = false;
      await restaurant.save();
      return res.status(403).json({
        success: false,
        message: 'Your subscription has expired. Please contact admin to renew.',
        status: 'expired'
      });
    }

    // Check password
    const isMatch = await restaurant.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = generateToken(restaurant._id);

    res.json({
      success: true,
      token,
      restaurant: {
        id: restaurant._id,
        name: restaurant.name,
        email: restaurant.email,
        phone: restaurant.phone,
        uniqueCode: restaurant.uniqueCode,
        subscriptionExpiry: restaurant.subscriptionExpiry,
        subscriptionStatus: restaurant.subscriptionStatus
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current restaurant
// @access  Private
router.get('/me', async (req, res) => {
  try {
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) return res.status(401).json({ success: false, message: 'Not authorized' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const restaurant = await Restaurant.findById(decoded.id);

    if (!restaurant) return res.status(404).json({ success: false, message: 'Restaurant not found' });

    res.json({ success: true, restaurant });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

module.exports = router;
