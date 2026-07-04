const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Restaurant = require('../models/Restaurant');

// @route   GET /api/restaurant/profile
// @desc    Get restaurant profile
// @access  Private
router.get('/profile', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    res.json({
      success: true,
      restaurant
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

// @route   PUT /api/restaurant/razorpay
// @desc    Update Razorpay credentials
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
      message: 'Razorpay credentials updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating Razorpay credentials'
    });
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

    res.json({
      success: true,
      restaurant: {
        _id: restaurant._id,          // ✅ ADD THIS LINE
        id: restaurant._id.toString(), // ✅ ADD THIS LINE for compatibility
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