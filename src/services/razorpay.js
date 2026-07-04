const Razorpay = require('razorpay');

/**
 * Create Razorpay order
 */
async function createRazorpayOrder(amount, orderId, keyId, keySecret) {
  try {
    const razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });

    const options = {
      amount: amount * 100, // Convert to paise
      currency: 'INR',
      receipt: orderId,
      notes: {
        orderId: orderId
      }
    };

    const order = await razorpayInstance.orders.create(options);
    return order;
  } catch (error) {
    console.error('Razorpay order creation error:', error);
    throw new Error('Failed to create Razorpay order');
  }
}

/**
 * Verify Razorpay payment signature
 */
function verifyPaymentSignature(orderId, paymentId, signature, keySecret) {
  const crypto = require('crypto');
  
  const text = orderId + '|' + paymentId;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(text)
    .digest('hex');
  
  return expectedSignature === signature;
}

module.exports = {
  createRazorpayOrder,
  verifyPaymentSignature
};
