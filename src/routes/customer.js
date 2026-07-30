const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Order = require('../models/Order');

/**
 * SELF-HEAL: if a customer's currentOrderId points at an order that is
 * already completed or cancelled (or deleted), move it to history and
 * clear it — right at read time. This guarantees a returning customer
 * NEVER sees a finished order as their "current order", even if every
 * other cleanup path failed (customer closed the tab, old stale data
 * from before this fix, etc).
 */
async function healCurrentOrder(customer) {
  if (!customer || !customer.currentOrderId) return customer;

  try {
    const order = await Order.findById(customer.currentOrderId).select('orderStatus');

    if (!order || order.orderStatus === 'completed' || order.orderStatus === 'cancelled') {
      if (order && order.orderStatus === 'completed') {
        const alreadyInHistory = customer.orderHistory.some(
          h => h.orderId && h.orderId.toString() === customer.currentOrderId.toString()
        );
        if (!alreadyInHistory) {
          customer.orderHistory.push({
            orderId: customer.currentOrderId,
            completedAt: new Date()
          });
        }
        customer.isExistingCustomer = true;
      }
      customer.currentOrderId = null;
      await customer.save();
    }
  } catch (e) {
    console.error('healCurrentOrder error:', e);
  }
  return customer;
}

// @route   GET /api/customer/lookup?phone=xxx&restaurantId=xxx
// @desc    Look up customer by phone number and restaurant
// @access  Public
router.get('/lookup', async (req, res) => {
  try {
    const { phone, restaurantId } = req.query;

    if (!phone || !restaurantId) {
      return res.status(400).json({ success: false, message: 'phone and restaurantId required' });
    }

    let customer = await Customer.findOne({ phone, restaurantId });

    if (!customer) {
      return res.json({ success: true, found: false });
    }

    customer = await healCurrentOrder(customer);

    res.json({
      success: true,
      found: true,
      customer: {
        customerId: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        isExistingCustomer: customer.isExistingCustomer,
        currentOrderId: customer.currentOrderId,
        // orderHistory deliberately NOT returned here — the menu page doesn't
        // use it, and omitting it means a phone-number lookup reveals as
        // little as possible. Full history stays behind /:customerId/order-history.
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
    let customer = await Customer.findOne({ customerId: req.params.customerId });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    customer = await healCurrentOrder(customer);

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

    // Build a set of order IDs already in history
    const historyIds = new Set(
      customer.orderHistory
        .filter(h => h.orderId)
        .map(h => h.orderId._id ? h.orderId._id.toString() : h.orderId.toString())
    );

    // Fallback: also query completed orders directly by phone + restaurant.
    // This catches any orders that were completed before the server-side fix,
    // or where the client-side complete-order call never fired.
    let extraOrders = [];
    if (customer.phone && customer.restaurantId) {
      const directCompleted = await Order.find({
        customerPhone: customer.phone,
        restaurantId: customer.restaurantId,
        orderStatus: 'completed'
      }).select('items totalAmount orderStatus paymentStatus tableNumber createdAt customerName updatedAt');

      for (const o of directCompleted) {
        if (!historyIds.has(o._id.toString())) {
          extraOrders.push({ orderId: o, completedAt: o.updatedAt || o.createdAt });
          // Also persist it into history so future calls don't need the fallback
          customer.orderHistory.push({ orderId: o._id, completedAt: o.updatedAt || o.createdAt });
        }
      }
      if (extraOrders.length > 0) {
        customer.isExistingCustomer = true;
        await customer.save();
      }
    }

    const fromHistory = customer.orderHistory
      .filter(entry => entry.orderId !== null)
      .map(entry => ({
        orderId: entry.orderId,
        completedAt: entry.completedAt
      }));

    // Merge history entries with any extra orders found via direct query,
    // then sort newest first
    const allOrders = [...fromHistory, ...extraOrders];
    const seen = new Set();
    const merged = allOrders
      .filter(entry => {
        const id = entry.orderId?._id
          ? entry.orderId._id.toString()
          : entry.orderId?.toString();
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

    res.json({ success: true, orderHistory: merged });
  } catch (error) {
    console.error('Error fetching order history:', error);
    res.status(500).json({ success: false, message: 'Error fetching order history' });
  }
});

module.exports = router;
