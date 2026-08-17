const crypto = require('crypto');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const Customer = require('../models/Customer');
const { createRazorpayOrder } = require('../services/razorpay');

// @desc    Create new order
// @route   POST /api/orders/create
// @access  Public
exports.createOrder = async (req, res) => {
  try {
    const { restaurantId, items, customerPhone, customerName, tableNumber } = req.body;

    console.log('📦 Creating order:', {
      restaurantId,
      itemCount: Array.isArray(items) ? items.length : 0,
      tableNumber,
      customerPhone: customerPhone ? `${String(customerPhone).slice(0, 2)}******${String(customerPhone).slice(-2)}` : '',
      customerName: '[REDACTED]'
    });

    // Validation
    if (!restaurantId || !items || items.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID and items are required'
      });
    }

    if (!tableNumber) {
      return res.status(400).json({
        success: false,
        message: 'Table number is required'
      });
    }

    // ⚠️ THE FIX: razorpayKeyId is `select: false` in the Restaurant schema,
    // so it MUST be explicitly re-selected here. Previously only
    // `+razorpayKeySecret` was selected, which made restaurant.razorpayKeyId
    // always `undefined` and pushed every order into the
    // "Payment integration not configured" branch below.
    const restaurant = await Restaurant.findById(restaurantId)
      .select('+razorpayKeyId +razorpayKeySecret');

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    console.log('🏪 Restaurant found:', restaurant.name);

    // Block ordering for restaurants that are disabled / unapproved / expired
    if (!restaurant.isApproved || !restaurant.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This restaurant is not currently accepting orders.'
      });
    }

    if (restaurant.subscriptionExpiry && restaurant.subscriptionExpiry < new Date()) {
      return res.status(403).json({
        success: false,
        message: 'This restaurant is not currently accepting orders.'
      });
    }

    // Calculate total and build order items
    let totalAmount = 0;
    const orderItems = [];

    for (const item of items) {
      const menuItem = restaurant.menuItems.id(item.menuItemId);

      if (!menuItem) {
        console.error('❌ Menu item not found:', item.menuItemId);
        return res.status(400).json({
          success: false,
          message: `Menu item ${item.menuItemId} not found`
        });
      }

      if (!menuItem.available) {
        return res.status(400).json({
          success: false,
          message: `${menuItem.name} is currently unavailable`
        });
      }

      const qty = Number(item.quantity);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
        return res.status(400).json({
          success: false,
          message: `Invalid quantity for ${menuItem.name}`
        });
      }

      const itemTotal = menuItem.price * qty;
      totalAmount += itemTotal;

      orderItems.push({
        menuItemId: item.menuItemId,
        name: menuItem.name,
        price: menuItem.price,
        quantity: qty
      });

      console.log('✅ Added item:', menuItem.name, 'x', qty, '= ₹', itemTotal);
    }

    // Guard against floating-point drift (e.g. 799.97 + 4.35 style totals)
    totalAmount = Math.round(totalAmount * 100) / 100;

    console.log('💰 Total amount:', totalAmount);

    if (totalAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Order total must be greater than zero'
      });
    }

    // Create order in database
    const order = await Order.create({
      restaurantId,
      items: orderItems,
      totalAmount,
      customerPhone: customerPhone || '',
      customerName: customerName || 'Guest',
      tableNumber: tableNumber || 'N/A',
      paymentStatus: 'pending',
      orderStatus: 'pending'
    });

    console.log('✅ Order created in DB:', order._id);

    // Create Razorpay order if credentials are configured
    if (restaurant.razorpayKeyId && restaurant.razorpayKeySecret) {
      try {
        const razorpayOrder = await createRazorpayOrder(
          totalAmount,
          order._id.toString(),
          restaurant.razorpayKeyId,
          restaurant.razorpayKeySecret
        );

        order.razorpayOrderId = razorpayOrder.id;
        await order.save();

        console.log('💳 Razorpay order created:', razorpayOrder.id);

        return res.status(201).json({
          success: true,
          order,
          razorpayOrderId: razorpayOrder.id,
          razorpayKeyId: restaurant.razorpayKeyId,
          amount: totalAmount,
          amountInPaise: Math.round(totalAmount * 100)
        });
      } catch (razorpayError) {
        console.error('❌ Razorpay error:', razorpayError);

        // Mark the order as failed so it doesn't sit forever as "pending"
        order.paymentStatus = 'failed';
        await order.save();

        return res.status(502).json({
          success: false,
          order,
          message:
            'Could not start the payment. The restaurant’s payment keys may be invalid or expired.',
          razorpayError: razorpayError.message
        });
      }
    }

    // No payment configured — the restaurant genuinely has not saved keys yet
    console.log('⚠️ No Razorpay configured for restaurant', restaurant._id.toString());

    return res.status(201).json({
      success: true,
      order,
      paymentConfigured: false,
      message:
        'Order placed, but this restaurant has not connected online payments yet. Please pay at the counter.'
    });

  } catch (error) {
    console.error('❌ Order creation error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error creating order',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// @desc    Verify Razorpay payment
// @route   POST /api/orders/verify-payment
// @access  Public
exports.verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !orderId) {
      return res.status(400).json({ success: false, message: 'Missing payment details' });
    }

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Make sure the razorpay order id actually belongs to this order
    if (order.razorpayOrderId && order.razorpayOrderId !== razorpayOrderId) {
      return res.status(400).json({ success: false, message: 'Payment does not match this order' });
    }

    // Already verified — idempotent response, protects against double-submit
    if (order.paymentStatus === 'paid') {
      return res.json({ success: true, message: 'Payment already verified', order });
    }

    // Get restaurant's secret key (must be explicitly selected)
    const restaurant = await Restaurant.findById(order.restaurantId)
      .select('+razorpayKeySecret');

    if (!restaurant || !restaurant.razorpayKeySecret) {
      return res.status(500).json({
        success: false,
        message: 'Restaurant payment configuration missing'
      });
    }

    // Generate and compare signature
    const text = razorpayOrderId + '|' + razorpayPaymentId;
    const generatedSignature = crypto
      .createHmac('sha256', restaurant.razorpayKeySecret)
      .update(text)
      .digest('hex');

    const valid =
      generatedSignature.length === String(razorpaySignature).length &&
      crypto.timingSafeEqual(
        Buffer.from(generatedSignature),
        Buffer.from(String(razorpaySignature))
      );

    if (!valid) {
      console.error('❌ Payment signature verification failed for order', orderId);
      order.paymentStatus = 'failed';
      await order.save();
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature - Payment verification failed'
      });
    }

    console.log('✅ Payment signature verified');

    // Atomic find-AND-update guarded by paymentStatus still being un-paid —
    // the Razorpay webhook (webhook.js) can fire for the same order within
    // milliseconds of this request, so a plain read-then-save here could
    // race with it. Whichever request's update actually matches wins;
    // the loser's filter simply won't match anymore.
    const updatedOrder = await Order.findOneAndUpdate(
      { _id: order._id, paymentStatus: { $ne: 'paid' } },
      {
        $set: {
          razorpayPaymentId,
          razorpaySignature,
          paymentStatus: 'paid',
          orderStatus: 'received'
        }
      },
      { new: true }
    );

    if (updatedOrder) {
      // The order is only NOW genuinely placed, so this is the correct moment
      // to make it the customer's current order. Doing it server-side means it
      // is right even if the customer's phone died before it could tell us.
      await setCustomerCurrentOrder(updatedOrder);

      return res.json({
        success: true,
        message: 'Payment verified successfully',
        order: updatedOrder
      });
    }

    // Someone else (the webhook, almost certainly) already marked it paid in
    // the tiny window between our read above and this update — that's not an
    // error, just a race we lost. Return the current state as a success,
    // same as the "already verified" early-return above.
    const freshOrder = await Order.findById(order._id);
    return res.json({
      success: true,
      message: 'Payment already verified',
      order: freshOrder
    });
  } catch (error) {
    console.error('❌ Payment verification error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying payment'
    });
  }
};

// @desc    Get order status
// @route   GET /api/orders/:orderId/status
// @access  Public
exports.getOrderStatus = async (req, res) => {
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
        createdAt: order.createdAt,
        tableNumber: order.tableNumber
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching order status'
    });
  }
};

// @desc    Get full order details
// @route   GET /api/orders/:orderId
// @access  Public
exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Download a PDF bill/receipt for an order
// @route   GET /api/orders/:orderId/bill
// @access  Public (order IDs are unguessable ObjectIds, same access level as order status)
const PDFDocument = require('pdfkit');

exports.downloadBill = async (req, res) => {
  try {
    const order = await Order.findById(req.params.orderId)
      .populate('restaurantId', 'name phone address');

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    const restaurant = order.restaurantId || {};
    const shortId = order._id.toString().slice(-8).toUpperCase();

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=bill-${shortId}.pdf`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    // ── Header ──
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#1e293b')
      .text(restaurant.name || 'Restaurant', { align: 'center' });
    if (restaurant.address && (restaurant.address.city || restaurant.address.street)) {
      const addr = [restaurant.address.street, restaurant.address.city, restaurant.address.state, restaurant.address.pincode]
        .filter(Boolean).join(', ');
      doc.fontSize(10).font('Helvetica').fillColor('#666666').text(addr, { align: 'center' });
    }
    if (restaurant.phone) {
      doc.fontSize(10).fillColor('#666666').text(`Phone: ${restaurant.phone}`, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#3B82F6').text('RECEIPT', { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E5E7EB').stroke();
    doc.moveDown(0.5);

    // ── Order info ──
    doc.fontSize(10).font('Helvetica').fillColor('#1e293b');
    doc.text(`Bill No: ${shortId}`);
    doc.text(`Date: ${new Date(order.createdAt).toLocaleString('en-IN')}`);
    doc.text(`Table: ${order.tableNumber || '-'}`);
    doc.text(`Customer: ${order.customerName || 'Guest'}`);
    doc.moveDown(0.8);

    // ── Items table ──
    const tableTop = doc.y;
    doc.rect(40, tableTop, 515, 20).fill('#3B82F6');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10);
    doc.text('Item', 48, tableTop + 5, { width: 250 });
    doc.text('Qty', 310, tableTop + 5, { width: 50, align: 'center' });
    doc.text('Price', 370, tableTop + 5, { width: 80, align: 'right' });
    doc.text('Amount', 460, tableTop + 5, { width: 85, align: 'right' });

    let y = tableTop + 20;
    doc.font('Helvetica').fontSize(10);
    order.items.forEach((item, i) => {
      const rowColor = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
      doc.rect(40, y, 515, 18).fill(rowColor);
      doc.fillColor('#1e293b');
      doc.text(item.name, 48, y + 4, { width: 250 });
      doc.text(String(item.quantity), 310, y + 4, { width: 50, align: 'center' });
      doc.text(`Rs. ${item.price.toFixed(2)}`, 370, y + 4, { width: 80, align: 'right' });
      doc.text(`Rs. ${(item.price * item.quantity).toFixed(2)}`, 460, y + 4, { width: 85, align: 'right' });
      y += 18;
    });

    // ── Total ──
    doc.rect(40, y, 515, 24).fill('#DBEAFE');
    doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(12);
    doc.text('TOTAL', 48, y + 6, { width: 250 });
    doc.text(`Rs. ${order.totalAmount.toFixed(2)}`, 460, y + 6, { width: 85, align: 'right' });
    y += 34;

    // ── Payment status ──
    doc.font('Helvetica').fontSize(10);
    const paid = order.paymentStatus === 'paid';
    doc.fillColor(paid ? '#16A34A' : '#DC2626')
      .text(paid ? `PAID ONLINE${order.razorpayPaymentId ? ` (Ref: ${order.razorpayPaymentId})` : ''}` : `Payment: ${order.paymentStatus.toUpperCase()}`, 48, y);
    y += 24;

    doc.fillColor('#666666').fontSize(9)
      .text('Thank you for dining with us! Please visit again.', 40, y, { width: 515, align: 'center' });
    doc.fontSize(8).fillColor('#9CA3AF')
      .text('Generated by QR Dine', 40, y + 16, { width: 515, align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Bill generation error:', error);
    res.status(500).json({ success: false, message: 'Error generating bill' });
  }
};

/**
 * Point the customer's profile at this order once it is genuinely placed.
 * Customers are identified by phone + restaurant (there is no login), which
 * is the same pairing used everywhere else in the app.
 */
async function setCustomerCurrentOrder(order) {
  try {
    if (!order.customerPhone) return;
    const customer = await Customer.findOne({
      phone: order.customerPhone,
      restaurantId: order.restaurantId
    });
    if (!customer) return;
    customer.currentOrderId = order._id;
    customer.lastVisit = new Date();
    await customer.save();
  } catch (e) {
    // Never let this break payment verification
    console.error('setCustomerCurrentOrder error:', e);
  }
}

exports.setCustomerCurrentOrder = setCustomerCurrentOrder;

module.exports = exports;
