const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  customerId: {
    type: String,
    unique: true,
    default: () => 'CUST' + Math.random().toString(36).substring(2, 12).toUpperCase()
  },
  name: String,
  phone: String,
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  currentOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  orderHistory: [{
    orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    completedAt: Date
  }],
  firstVisit: { type: Date, default: Date.now },
  lastVisit: { type: Date, default: Date.now },
  isExistingCustomer: { type: Boolean, default: false }
}, { timestamps: true });

// The hot lookup path in routes/customer.js is Customer.findOne({ phone, restaurantId })
// on every diner who enters their phone number — this compound index serves it directly.
customerSchema.index({ restaurantId: 1, phone: 1 });

module.exports = mongoose.model('Customer', customerSchema);