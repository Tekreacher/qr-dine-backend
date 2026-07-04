const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Order = require('../models/Order');

// @route   GET /api/customer/lookup?phone=xxx&restaurantId=xxx
// @desc    Look up customer by phone number and restaurant
// @access  Public
router.get('/lookup', async (req, res) => {
  try {
    const { phone, restaurantId } = req.query;

    if (!phone || !restaurantId) {
      return res.status(400).json({ success: false, message: 'phone and restaurantId required' });
    }

    const customer = await Customer.findOne({ phone, restaurantId });

    if (!customer) {
      return res.json({ success: true, found: false });
    }

    res.json({
      success: true,
      found: true,
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        isExistingCustomer: customer.isExistingCustomer,
        currentOrderId: customer.currentOrderId,
        orderHistory: customer.orderHistory,
        firstVisit: customer.firstVisit,
        lastVisit: customer.lastVisit
      }
    });
  } catch (error) {
    console.error('Error looking up customer:', error);
    res.status(500).json({ success: false, message: 'Error looking up customer' });
  }
});

// @route   POST /api/customer/create-or-get
// @desc    Create customer profile or get existing (called on first order)
// @access  Public
router.post('/create-or-get', async (req, res) => {
  try {
    const { name, phone, restaurantId } = req.body;

    let customer = await Customer.findOne({ phone, restaurantId });

    if (customer) {
      // Update name and last visit
      if (name) customer.name = name;
      customer.lastVisit = new Date();
      await customer.save();
    } else {
      customer = await Customer.create({ name, phone, restaurantId });
    }

    res.json({
      success: true,
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        isExistingCustomer: customer.isExistingCustomer
      }
    });
  } catch (error) {
    console.error('Error creating/getting customer:', error);
    res.status(500).json({ success: false, message: 'Error managing customer profile' });
  }
});

// @route   GET /api/customer/:customerId/profile
// @desc    Get customer profile by customerId
// @access  Public
router.get('/:customerId/profile', async (req, res) => {
  try {
    const customer = await Customer.findOne({ customerId: req.params.customerId });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({
      success: true,
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        isExistingCustomer: customer.isExistingCustomer,
        currentOrderId: customer.currentOrderId,
        orderHistory: customer.orderHistory,
        firstVisit: customer.firstVisit,
        lastVisit: customer.lastVisit
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching customer profile' });
  }
});

// @route   PUT /api/customer/:customerId/current-order
// @desc    Set current order for customer
// @access  Public
router.put('/:customerId/current-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    const customer = await Customer.findOne({ customerId: req.params.customerId });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    customer.currentOrderId = orderId;
    customer.lastVisit = new Date();
    await customer.save();

    res.json({ success: true, message: 'Current order updated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating current order' });
  }
});

// @route   POST /api/customer/:customerId/complete-order
// @desc    Move current order to history and mark as existing customer
// @access  Public
router.post('/:customerId/complete-order', async (req, res) => {
  try {
    const customer = await Customer.findOne({ customerId: req.params.customerId });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    // Use orderId from request body first (most reliable), then fall back to DB currentOrderId
    const orderIdToComplete = req.body.orderId || customer.currentOrderId || null;

    if (orderIdToComplete) {
      const alreadyInHistory = customer.orderHistory.some(
        h => h.orderId && h.orderId.toString() === orderIdToComplete.toString()
      );

      if (!alreadyInHistory) {
        customer.orderHistory.push({
          orderId: orderIdToComplete,
          completedAt: new Date()
        });
      }

      customer.currentOrderId = null;
    }

    // Mark as existing customer after first completed order
    customer.isExistingCustomer = true;
    await customer.save();

    res.json({ success: true, message: 'Order moved to history' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error completing order' });
  }
});

// @route   GET /api/customer/:customerId/order-history
// @desc    Get customer order history with full order details
// @access  Public
router.get('/:customerId/order-history', async (req, res) => {
  try {
    const customer = await Customer.findOne({ customerId: req.params.customerId }).populate({
      path: 'orderHistory.orderId',
      select: 'items totalAmount orderStatus paymentStatus tableNumber createdAt customerName'
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const cleanHistory = customer.orderHistory
      .filter(entry => entry.orderId !== null)
      .map(entry => ({
        orderId: entry.orderId,
        completedAt: entry.completedAt
      }))
      .reverse();

    res.json({ success: true, orderHistory: cleanHistory });
  } catch (error) {
    console.error('Error fetching order history:', error);
    res.status(500).json({ success: false, message: 'Error fetching order history' });
  }
});

module.exports = router;