const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const orderAdminController = require('../controllers/orderAdminController');

// All routes require authentication
router.use(protect);

// @route   GET /api/admin/orders
router.get('/', orderAdminController.getRestaurantOrders);

// @route   GET /api/admin/orders/analytics
router.get('/analytics', orderAdminController.getAnalytics);

// @route   GET /api/admin/orders/export
router.get('/export', orderAdminController.exportOrders);

// @route   PUT /api/admin/orders/:orderId/ready
router.put('/:orderId/ready', orderAdminController.markOrderReady);

// @route   PUT /api/admin/orders/:orderId/status
router.put('/:orderId/status', orderAdminController.updateOrderStatus);

module.exports = router;