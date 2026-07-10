const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const menuItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  price: { type: Number, required: true },
  category: { type: String, required: true },
  image: String,
  available: { type: Boolean, default: true },
  veg: { type: Boolean, default: true }
});

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  order: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Restaurant name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 6,
    select: false
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required']
  },
  address: {
    street: String,
    city: String,
    state: String,
    pincode: String
  },
  categories: [categorySchema],
  menuItems: [menuItemSchema],
  qrCode: String,
  uniqueCode: {
    type: String,
    unique: true
  },
  // All QR codes ever generated — all remain active forever
  allQrCodes: [{
    uniqueCode: String,
    qrCode: String,
    createdAt: { type: Date, default: Date.now }
  }],
  razorpayKeyId: String,
  razorpayKeySecret: String,

  // Admin approval & subscription
  isApproved: { type: Boolean, default: false },
  isActive: { type: Boolean, default: false },
  subscriptionExpiry: { type: Date, default: null },
  subscriptionStatus: {
    type: String,
    enum: ['pending', 'active', 'expired', 'rejected'],
    default: 'pending'
  },
  ownerPhone: { type: String, default: '' },
  ownerName: { type: String, default: '' },

}, { timestamps: true });

// Hash password before saving
restaurantSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Match password
restaurantSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate unique code
restaurantSchema.pre('save', function(next) {
  if (!this.uniqueCode) {
    this.uniqueCode = Math.random().toString(36).substring(2, 10).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Restaurant', restaurantSchema);