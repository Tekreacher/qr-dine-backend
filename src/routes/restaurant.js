const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { protect } = require('../middleware/auth');
const Restaurant = require('../models/Restaurant');
const { sendVaultOtpEmail } = require('../services/emailService');

// ── Helper: mask a Razorpay Key ID for display, e.g. rzp_test_SDGs****Igvgd ──
function maskKeyId(key) {
  if (!key) return null;
  if (key.length <= 12) return '****';
  return `${key.slice(0, 8)}${'*'.repeat(Math.max(key.length - 12, 4))}${key.slice(-4)}`;
}

// ── Helper: validate vault password strength ──
function isStrongVaultPassword(pw) {
  // Min 8 chars, at least 1 letter, 1 number, 1 special character
  return /^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(pw || '');
}

// @route   GET /api/restaurant/profile
// @desc    Get restaurant profile (Razorpay secret NEVER included; key ID masked if vault enabled)
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id).select('+razorpayKeyId +razorpayVaultEnabled');

    const restaurantObj = restaurant.toObject();
    delete restaurantObj.razorpayKeySecret;
    delete restaurantObj.razorpayVaultPasswordHash;
    delete restaurantObj.razorpayOtpHash;
    delete restaurantObj.razorpayOtpExpiry;

    // Once vault is enabled, don't expose even the key ID in plain profile fetch
    if (restaurant.razorpayVaultEnabled) {
      delete restaurantObj.razorpayKeyId;
    }

    res.json({
      success: true,
      restaurant: restaurantObj
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching profile'
    });
  }
});

// @route   PUT /api/restaurant/profile
// @desc    Update restaurant profile
// @access  Private
router.put('/profile', protect, async (req, res) => {
  try {
    const { name, phone, address } = req.body;

    const restaurant = await Restaurant.findById(req.restaurant._id);

    if (name) restaurant.name = name;
    if (phone) restaurant.phone = phone;
    if (address) restaurant.address = address;

    await restaurant.save();

    res.json({
      success: true,
      restaurant
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
});

// @route   GET /api/restaurant/razorpay-status
// @desc    Get Razorpay configuration status (masked, never exposes secret)
// @access  Private
router.get('/razorpay-status', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id)
      .select('+razorpayKeyId +razorpayKeySecret +razorpayVaultEnabled');

    const configured = !!(restaurant.razorpayKeyId && restaurant.razorpayKeySecret);

    res.json({
      success: true,
      configured,
      vaultEnabled: !!restaurant.razorpayVaultEnabled,
      maskedKeyId: configured ? maskKeyId(restaurant.razorpayKeyId) : null
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching Razorpay status' });
  }
});

// @route   PUT /api/restaurant/razorpay
// @desc    Save/update Razorpay credentials (owner is already authenticated via dashboard login)
// @access  Private
router.put('/razorpay', protect, async (req, res) => {
  try {
    const { razorpayKeyId, razorpayKeySecret } = req.body;

    if (!razorpayKeyId || !razorpayKeySecret) {
      return res.status(400).json({
        success: false,
        message: 'Razorpay credentials are required'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id);
    restaurant.razorpayKeyId = razorpayKeyId;
    restaurant.razorpayKeySecret = razorpayKeySecret;

    await restaurant.save();

    res.json({
      success: true,
      message: 'Razorpay credentials updated successfully',
      vaultEnabled: !!restaurant.razorpayVaultEnabled
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating Razorpay credentials'
    });
  }
});

// @route   POST /api/restaurant/razorpay-vault/set-password
// @desc    Set a password to secure/hide Razorpay credentials for the first time
// @access  Private
router.post('/razorpay-vault/set-password', protect, async (req, res) => {
  try {
    const { password } = req.body;

    if (!isStrongVaultPassword(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters and include a letter, a number, and a special character.'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id).select('+razorpayKeyId +razorpayKeySecret');

    if (!restaurant.razorpayKeyId || !restaurant.razorpayKeySecret) {
      return res.status(400).json({
        success: false,
        message: 'Please save your Razorpay credentials first before setting a password.'
      });
    }

    const hash = await bcrypt.hash(password, 10);
    restaurant.razorpayVaultPasswordHash = hash;
    restaurant.razorpayVaultEnabled = true;
    await restaurant.save();

    res.json({ success: true, message: 'Your Razorpay credentials are now secured with a password.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error setting vault password' });
  }
});

// @route   POST /api/restaurant/razorpay-vault/unlock
// @desc    Verify vault password and return the real Razorpay credentials
// @access  Private
router.post('/razorpay-vault/unlock', protect, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id)
      .select('+razorpayKeyId +razorpayKeySecret +razorpayVaultPasswordHash +razorpayVaultEnabled');

    if (!restaurant.razorpayVaultEnabled || !restaurant.razorpayVaultPasswordHash) {
      return res.status(400).json({ success: false, message: 'Vault password is not set' });
    }

    const isMatch = await bcrypt.compare(password, restaurant.razorpayVaultPasswordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    res.json({
      success: true,
      razorpayKeyId: restaurant.razorpayKeyId,
      razorpayKeySecret: restaurant.razorpayKeySecret
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error unlocking credentials' });
  }
});

// @route   POST /api/restaurant/razorpay-vault/change-password
// @desc    Change vault password (requires current password)
// @access  Private
router.post('/razorpay-vault/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!isStrongVaultPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters and include a letter, a number, and a special character.'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id).select('+razorpayVaultPasswordHash');

    const isMatch = await bcrypt.compare(currentPassword || '', restaurant.razorpayVaultPasswordHash || '');
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    restaurant.razorpayVaultPasswordHash = await bcrypt.hash(newPassword, 10);
    await restaurant.save();

    res.json({ success: true, message: 'Vault password updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error changing vault password' });
  }
});

// @route   POST /api/restaurant/razorpay-vault/forgot-password
// @desc    Send a 6-digit OTP to the restaurant's registered email to reset vault password
// @access  Private
router.post('/razorpay-vault/forgot-password', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    restaurant.razorpayOtpHash = otpHash;
    restaurant.razorpayOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await restaurant.save();

    await sendVaultOtpEmail(restaurant.email, otp, restaurant.name);

    res.json({ success: true, message: `OTP sent to ${restaurant.email}` });
  } catch (error) {
    console.error('OTP send error:', error);
    res.status(500).json({ success: false, message: 'Error sending OTP. Please try again.' });
  }
});

// @route   POST /api/restaurant/razorpay-vault/reset-password
// @desc    Verify OTP and set a new vault password
// @access  Private
router.post('/razorpay-vault/reset-password', protect, async (req, res) => {
  try {
    const { otp, newPassword } = req.body;

    if (!isStrongVaultPassword(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 8 characters and include a letter, a number, and a special character.'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id)
      .select('+razorpayOtpHash +razorpayOtpExpiry');

    if (!restaurant.razorpayOtpHash || !restaurant.razorpayOtpExpiry) {
      return res.status(400).json({ success: false, message: 'No OTP request found. Please request a new OTP.' });
    }

    if (restaurant.razorpayOtpExpiry < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await bcrypt.compare(otp || '', restaurant.razorpayOtpHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid OTP' });
    }

    restaurant.razorpayVaultPasswordHash = await bcrypt.hash(newPassword, 10);
    restaurant.razorpayVaultEnabled = true;
    restaurant.razorpayOtpHash = undefined;
    restaurant.razorpayOtpExpiry = undefined;
    await restaurant.save();

    res.json({ success: true, message: 'Vault password reset successfully. You can now unlock your credentials.' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error resetting vault password' });
  }
});

// @route   GET /api/restaurant/:uniqueCode
// @desc    Get restaurant by unique code (public)
// @access  Public
router.get('/:uniqueCode', async (req, res) => {
  try {
    // Search current uniqueCode OR any code in allQrCodes array
    // This ensures ALL old printed QR codes remain active forever
    const restaurant = await Restaurant.findOne({
      $or: [
        { uniqueCode: req.params.uniqueCode },
        { 'allQrCodes.uniqueCode': req.params.uniqueCode }
      ]
    });

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Block ordering if restaurant is disabled, not approved, or subscription expired
    if (!restaurant.isApproved || !restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This restaurant is currently not accepting orders. Please contact the restaurant.'
      });
    }

    if (restaurant.subscriptionExpiry && restaurant.subscriptionExpiry < new Date()) {
      return res.status(403).json({
        success: false,
        message: 'This restaurant is currently not accepting orders. Please contact the restaurant.'
      });
    }

    res.json({
      success: true,
      restaurant: {
        _id: restaurant._id,
        id: restaurant._id.toString(),
        name: restaurant.name,
        address: restaurant.address,
        menuItems: restaurant.menuItems.filter(item => item.available),
        razorpayKeyId: restaurant.razorpayKeyId
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching restaurant'
    });
  }
});

module.exports = router;
