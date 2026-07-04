const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');

// @route   POST /api/orders/create
// @desc    Create new order
// @access  Public
router.post('/create', orderController.createOrder);

// @route   POST /api/orders/verify-payment
// @desc    Verify Razorpay payment
// @access  Public
router.post('/verify-payment', orderController.verifyPayment);

// @route   GET /api/orders/:orderId/status
// @desc    Get order status
// @access  Public
router.get('/:orderId/status', orderController.getOrderStatus);

// @route   GET /api/orders/:orderId
// @desc    Get full order details
// @access  Public
router.get('/:orderId', orderController.getOrderById);


module.exports = router;