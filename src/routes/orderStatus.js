const express = require('express');
const router = express.Router();
const Order = require('../models/Order');

// @route   GET /api/order-status/:orderId
// @desc    Get order status (public endpoint for customers)
// @access  Public
router.get('/:orderId', async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('restaurantId', 'name phone address');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      order: {
        id: order._id,
        restaurant: order.restaurantId,
        items: order.items,
        totalAmount: order.totalAmount,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        isReady: order.isReady,
        readyAt: order.readyAt,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order status'
    });
  }
});

module.exports = router;