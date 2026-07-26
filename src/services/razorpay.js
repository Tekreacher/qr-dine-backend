const Razorpay = require('razorpay');
const crypto = require('crypto');

/**
 * Create a Razorpay order using the RESTAURANT'S OWN key pair.
 * amount is in rupees; Razorpay needs integer paise.
 */
async function createRazorpayOrder(amount, orderId, keyId, keySecret) {
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials missing for this restaurant');
  }

  const razorpayInstance = new Razorpay({
    key_id: String(keyId).trim(),
    key_secret: String(keySecret).trim()
  });

  // ⚠️ FIX: `amount * 100` produces floats like 434.99999999999994 for
  // prices such as ₹4.35. Razorpay rejects non-integer amounts, which
  // showed up as a generic "payment initialization failed".
  const amountInPaise = Math.round(Number(amount) * 100);

  if (!Number.isInteger(amountInPaise) || amountInPaise < 100) {
    throw new Error('Order amount must be at least ₹1');
  }

  const options = {
    amount: amountInPaise,
    currency: 'INR',
    // Razorpay caps receipt at 40 chars — a Mongo ObjectId is 24, so this is safe
    receipt: String(orderId).slice(0, 40),
    notes: { orderId: String(orderId) }
  };

  try {
    return await razorpayInstance.orders.create(options);
  } catch (error) {
    // Surface the REAL reason instead of swallowing it. Razorpay SDK errors
    // carry the useful text on error.error.description.
    const reason =
      error?.error?.description ||
      error?.description ||
      error?.message ||
      'Unknown Razorpay error';
    console.error('Razorpay order creation error:', reason, error?.statusCode || '');
    throw new Error(`Razorpay: ${reason}`);
  }
}

/**
 * Verify a Razorpay payment signature (HMAC-SHA256, timing-safe).
 */
function verifyPaymentSignature(orderId, paymentId, signature, keySecret) {
  const text = `${orderId}|${paymentId}`;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(text)
    .digest('hex');

  if (expected.length !== String(signature || '').length) return false;

  return crypto.timingSafeEqual(
    Buffer.from(expected),
    Buffer.from(String(signature))
  );
}

/**
 * Refund a captured payment (full or partial) using the restaurant's own keys.
 * amount is optional — omit for a full refund, or pass rupees for a partial one.
 */
async function refundPayment(paymentId, keyId, keySecret, amount) {
  if (!keyId || !keySecret) {
    throw new Error('Razorpay credentials missing for this restaurant');
  }

  const razorpayInstance = new Razorpay({
    key_id: String(keyId).trim(),
    key_secret: String(keySecret).trim()
  });

  const options = {};
  if (amount !== undefined && amount !== null) {
    options.amount = Math.round(Number(amount) * 100);
  }

  try {
    return await razorpayInstance.payments.refund(paymentId, options);
  } catch (error) {
    const reason =
      error?.error?.description ||
      error?.description ||
      error?.message ||
      'Unknown Razorpay error';
    console.error('Razorpay refund error:', reason);
    throw new Error(`Razorpay refund: ${reason}`);
  }
}

module.exports = {
  createRazorpayOrder,
  verifyPaymentSignature,
  refundPayment
};
