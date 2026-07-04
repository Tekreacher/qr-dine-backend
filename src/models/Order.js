const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  menuItemId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true 
  },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 }
});

const orderSchema = new mongoose.Schema({
  restaurantId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Restaurant',
    required: true 
  },
  tableNumber: { 
    type: String,
    required: true,
    default: 'N/A'
  },
  items: [orderItemSchema],
  totalAmount: { 
    type: Number, 
    required: true 
  },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },
  orderStatus: { 
    type: String, 
    enum: ['pending', 'received', 'preparing', 'ready', 'completed', 'cancelled'],
    default: 'pending'  // ✅ CHANGED: Start with 'pending', moves to 'received' after payment
  },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  razorpaySignature: String,
  customerPhone: String,
  customerName: String,
  isReady: { 
    type: Boolean, 
    default: false 
  },
  readyAt: Date
}, {
  timestamps: true
});

module.exports = mongoose.model('Order', orderSchema);

