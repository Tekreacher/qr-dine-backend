const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const { createRazorpayOrder } = require('../services/razorpay');

// @desc    Create new order
// @route   POST /api/orders/create
// @access  Public
exports.createOrder = async (req, res) => {
  try {
    const { restaurantId, items, customerPhone, customerName, tableNumber } = req.body;

    console.log('📦 Creating order:', { restaurantId, items, customerPhone, customerName, tableNumber });

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

    // Get restaurant
    const restaurant = await Restaurant.findById(restaurantId).select('+razorpayKeySecret');
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    console.log('🏪 Restaurant found:', restaurant.name);

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

      const itemTotal = menuItem.price * item.quantity;
      totalAmount += itemTotal;

      orderItems.push({
        menuItemId: item.menuItemId,
        name: menuItem.name,
        price: menuItem.price,
        quantity: item.quantity
      });

      console.log('✅ Added item:', menuItem.name, 'x', item.quantity, '= ₹', itemTotal);
    }

    console.log('💰 Total amount:', totalAmount);

    // Create order in database
    const order = await Order.create({
      restaurantId,
      items: orderItems,
      totalAmount,
      customerPhone: customerPhone || '',
      customerName: customerName || 'Guest',
      tableNumber: tableNumber || 'N/A',
      paymentStatus: 'pending',
      orderStatus: 'pending' // Changed from 'received' to 'pending' initially
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
          amount: totalAmount
        });
      } catch (razorpayError) {
        console.error('❌ Razorpay error:', razorpayError);
        
        // Even if Razorpay fails, return the order
        return res.status(201).json({
          success: true,
          order,
          message: 'Order created but payment initialization failed',
          razorpayError: razorpayError.message
        });
      }
    }

    // No payment configured - return order anyway
    console.log('⚠️ No Razorpay configured');
    
    res.status(201).json({
      success: true,
      order,
      message: 'Order created. Payment integration not configured.'
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
const crypto = require('crypto');

exports.verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, orderId } = req.body;

    const order = await Order.findById(orderId).populate('restaurantId');
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Get restaurant's secret key
    const restaurant = await Restaurant.findById(order.restaurantId).select('+razorpayKeySecret');
    
    // Generate signature
    const text = razorpayOrderId + '|' + razorpayPaymentId;
    const generatedSignature = crypto
      .createHmac('sha256', restaurant.razorpayKeySecret)
      .update(text)
      .digest('hex');

    // Verify signature
    if (generatedSignature !== razorpaySignature) {
      console.error('❌ Payment signature verification failed');
      return res.status(400).json({
        success: false,
        message: 'Invalid payment signature - Payment verification failed'
      });
    }

    console.log('✅ Payment signature verified');

    // Update order
    order.razorpayPaymentId = razorpayPaymentId;
    order.razorpaySignature = razorpaySignature;
    order.paymentStatus = 'paid';
    order.orderStatus = 'received';
    await order.save();

    res.json({
      success: true,
      message: 'Payment verified successfully',
      order
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




exports.getOrderById = async (req, res) => {
  try {
    const { orderId } = req.params;

    const order = await Order.findById(orderId);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    res.status(200).json(order);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};






module.exports = exports;