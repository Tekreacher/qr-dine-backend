const jwt = require('jsonwebtoken');
const Restaurant = require('../models/Restaurant');

exports.protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const restaurant = await Restaurant.findById(decoded.id);

    if (!restaurant) {
      return res.status(401).json({ success: false, message: 'Restaurant not found' });
    }

    // Block if not approved or disabled
    if (!restaurant.isApproved || !restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been disabled. Please contact admin.',
        status: 'disabled'
      });
    }

    // Block if subscription expired
    if (restaurant.subscriptionExpiry && restaurant.subscriptionExpiry < new Date()) {
      return res.status(403).json({
        success: false,
        message: 'Your subscription has expired. Please contact admin to renew.',
        status: 'expired'
      });
    }

    req.restaurant = restaurant;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this route'
    });
  }
};
