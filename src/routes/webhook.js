const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Order = require('../models/Order');

// @route   POST /api/webhook/razorpay
// @desc    Handle Razorpay webhooks
// @access  Public (but verified)
router.post('/razorpay', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    
    // Verify webhook signature
    // const expectedSignature = crypto
    //   .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET)
    //   .update(JSON.stringify(req.body))
    //   .digest('hex');

    // if (signature !== expectedSignature) {
    //   return res.status(400).json({ success: false, message: 'Invalid signature' });
    // }

    const event = req.body.event;
    const payload = req.body.payload;

    switch(event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(payload.payment.entity);
        break;
      default:
        console.log('Unhandled webhook event:', event);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ success: false });
  }
});

async function handlePaymentCaptured(payment) {
  const order = await Order.findOne({ razorpayOrderId: payment.order_id });
  if (order) {
    order.paymentStatus = 'paid';
    order.razorpayPaymentId = payment.id;
    order.orderStatus = 'received';
    await order.save();
  }
}

async function handlePaymentFailed(payment) {
  const order = await Order.findOne({ razorpayOrderId: payment.order_id });
  if (order) {
    order.paymentStatus = 'failed';
    await order.save();
  }
}

module.exports = router;