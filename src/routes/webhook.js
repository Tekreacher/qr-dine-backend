const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const { setCustomerCurrentOrder } = require('../controllers/orderController');

// @route   POST /api/webhook/razorpay/:restaurantId
// @desc    Handle Razorpay webhooks (payment.captured / payment.failed)
// @access  Public, but signature-verified against THIS restaurant's own
//          webhook secret — since every restaurant has its own Razorpay
//          account, there is no single global webhook secret; each
//          restaurant configures its own webhook URL + secret in their own
//          Razorpay Dashboard → Settings → Webhooks, pointing at:
//            https://<your-api-domain>/api/webhook/razorpay/<their restaurantId>
//          with events: payment.captured, payment.failed
//
// ⚠️ FIX: this route previously had signature verification commented out
// entirely, meaning anyone could POST a fake "payment.captured" body and
// mark any order as paid for free. It is required now — requests without a
// valid signature are rejected with 400.
//
// NOTE: express.raw() is required here (not express.json()) because HMAC
// verification must run against the exact raw bytes Razorpay signed, not a
// re-serialized JSON object, which can produce a different byte string.
router.post(
  '/razorpay/:restaurantId',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    try {
      const { restaurantId } = req.params;
      const signature = req.headers['x-razorpay-signature'];

      if (!signature) {
        return res.status(400).json({ success: false, message: 'Missing signature header' });
      }

      const restaurant = await Restaurant.findById(restaurantId)
        .select('+razorpayWebhookSecret');

      if (!restaurant || !restaurant.razorpayWebhookSecret) {
        // Don't leak whether the restaurant exists — just reject quietly
        return res.status(400).json({ success: false, message: 'Webhook not configured' });
      }

      const expectedSignature = crypto
        .createHmac('sha256', restaurant.razorpayWebhookSecret)
        .update(req.body) // raw Buffer — must match exactly what Razorpay signed
        .digest('hex');

      const valid =
        expectedSignature.length === String(signature).length &&
        crypto.timingSafeEqual(
          Buffer.from(expectedSignature),
          Buffer.from(String(signature))
        );

      if (!valid) {
        console.error('❌ Webhook signature mismatch for restaurant', restaurantId);
        return res.status(400).json({ success: false, message: 'Invalid signature' });
      }

      const payload = JSON.parse(req.body.toString('utf8'));
      const event = payload.event;

      switch (event) {
        case 'payment.captured':
          await handlePaymentCaptured(payload.payload.payment.entity, restaurantId);
          break;
        case 'payment.failed':
          await handlePaymentFailed(payload.payload.payment.entity, restaurantId);
          break;
        default:
          console.log('Unhandled webhook event:', event);
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Webhook error:', error);
      res.status(500).json({ success: false });
    }
  }
);

async function handlePaymentCaptured(payment, restaurantId) {
  const order = await Order.findOne({
    razorpayOrderId: payment.order_id,
    restaurantId
  });
  if (order && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'paid';
    order.razorpayPaymentId = payment.id;
    order.orderStatus = 'received';
    await order.save();

    // Same rule as the browser path: an order becomes the customer's
    // "current order" only once payment is confirmed.
    await setCustomerCurrentOrder(order);

    console.log('✅ Webhook confirmed payment for order', order._id.toString());
  }
}

async function handlePaymentFailed(payment, restaurantId) {
  const order = await Order.findOne({
    razorpayOrderId: payment.order_id,
    restaurantId
  });
  if (order && order.paymentStatus !== 'paid') {
    order.paymentStatus = 'failed';
    await order.save();
  }
}

module.exports = router;
