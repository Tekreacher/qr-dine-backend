const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const Restaurant = require('../models/Restaurant');
const { body, validationResult } = require('express-validator');

// Generate JWT Token
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE
  });
};

// @route   POST /api/auth/register
// @desc    Register restaurant
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
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { name, email, password, phone, address, ownerName, ownerPhone } = req.body;

    // Check if restaurant exists
    const existingRestaurant = await Restaurant.findOne({ email });
    if (existingRestaurant) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant with this email already exists'
      });
    }

    // Create restaurant
    const restaurant = await Restaurant.create({
      name,
      email,
      password,
      ownerName: ownerName || name,
      ownerPhone: ownerPhone || phone || '',
      phone,
      address
    });

    const token = generateToken(restaurant._id);

    res.status(201).json({
      success: true,
      token,
      restaurant: {
        id: restaurant._id,
        name: restaurant.name,
        email: restaurant.email,
        phone: restaurant.phone,
        uniqueCode: restaurant.uniqueCode
      }
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating restaurant account'
    });
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
      return res.status(400).json({ 
        success: false, 
        errors: errors.array() 
      });
    }

    const { email, password } = req.body;

    // Find restaurant with password
    const restaurant = await Restaurant.findOne({ email }).select('+password');
    
    if (!restaurant) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check approval status
    if (!restaurant.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending approval. Please contact the admin.',
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
        message: 'Your subscription has expired. Please contact the admin to renew.',
        status: 'expired'
      });
    }

    // Check password
    const isMatch = await restaurant.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
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
        uniqueCode: restaurant.uniqueCode
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error logging in'
    });
  }
});

module.exports = router;