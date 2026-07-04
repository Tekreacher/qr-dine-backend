const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Restaurant = require('../models/Restaurant');
const { generateQR } = require('../services/qrGenerator');
const multer = require('multer');

// Memory storage for images
const memoryStorage = multer.memoryStorage();
const imageUpload = multer({ 
  storage: memoryStorage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// ===== CATEGORY MANAGEMENT =====

// @route   GET /api/menu/categories
// @desc    Get all categories
// @access  Private
router.get('/categories', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    res.json({
      success: true,
      categories: restaurant.categories.sort((a, b) => a.order - b.order)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching categories'
    });
  }
});

// @route   POST /api/menu/categories
// @desc    Create new category
// @access  Private
router.post('/categories', protect, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Category name is required'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id);
    
    // Check if category already exists
    const exists = restaurant.categories.find(cat => 
      cat.name.toLowerCase() === name.toLowerCase()
    );
    
    if (exists) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }

    // Add new category
    restaurant.categories.push({
      name,
      order: restaurant.categories.length
    });
    
    await restaurant.save();

    res.json({
      success: true,
      message: 'Category created successfully',
      categories: restaurant.categories
    });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating category'
    });
  }
});

// @route   PUT /api/menu/categories/:categoryId
// @desc    Update category name
// @access  Private
router.put('/categories/:categoryId', protect, async (req, res) => {
  try {
    const { name } = req.body;
    const restaurant = await Restaurant.findById(req.restaurant._id);
    
    const category = restaurant.categories.id(req.params.categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const oldName = category.name;
    category.name = name;
    
    // Update all menu items with this category
    restaurant.menuItems.forEach(item => {
      if (item.category === oldName) {
        item.category = name;
      }
    });
    
    await restaurant.save();

    res.json({
      success: true,
      message: 'Category updated successfully',
      categories: restaurant.categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating category'
    });
  }
});

// @route   DELETE /api/menu/categories/:categoryId
// @desc    Delete category
// @access  Private
router.delete('/categories/:categoryId', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    const category = restaurant.categories.id(req.params.categoryId);
    
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const categoryName = category.name;
    
    // Remove category
    restaurant.categories.pull(req.params.categoryId);
    
    // Remove all items in this category
    restaurant.menuItems = restaurant.menuItems.filter(
      item => item.category !== categoryName
    );
    
    await restaurant.save();

    res.json({
      success: true,
      message: 'Category and its items deleted successfully',
      categories: restaurant.categories
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting category'
    });
  }
});

// @route   PUT /api/menu/categories/reorder
// @desc    Reorder categories
// @access  Private
router.put('/categories/reorder', protect, async (req, res) => {
  try {
    const { categoryIds } = req.body; // Array of category IDs in new order
    
    const restaurant = await Restaurant.findById(req.restaurant._id);
    
    categoryIds.forEach((id, index) => {
      const category = restaurant.categories.id(id);
      if (category) {
        category.order = index;
      }
    });
    
    await restaurant.save();

    res.json({
      success: true,
      message: 'Categories reordered successfully',
      categories: restaurant.categories.sort((a, b) => a.order - b.order)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error reordering categories'
    });
  }
});

// ===== MENU ITEM MANAGEMENT =====

// @route   GET /api/menu
// @desc    Get restaurant menu
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    res.json({
      success: true,
      menuItems: restaurant.menuItems,
      categories: restaurant.categories.sort((a, b) => a.order - b.order)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching menu'
    });
  }
});

// @route   POST /api/menu/item
// @desc    Add menu item with image upload to Cloudinary
// @access  Private
router.post('/item', protect, imageUpload.single('image'), async (req, res) => {
  try {
    const { name, description, price, category, veg } = req.body;

    console.log('📝 Received data:', { name, description, price, category, veg });
    console.log('📷 Image file:', req.file ? 'Yes' : 'No');

    if (!name || !price || !category) {
      return res.status(400).json({
        success: false,
        message: 'Name, price, and category are required'
      });
    }

    const restaurant = await Restaurant.findById(req.restaurant._id);
    
    // Check if category exists
    const categoryExists = restaurant.categories.find(cat => cat.name === category);
    if (!categoryExists) {
      return res.status(400).json({
        success: false,
        message: 'Category does not exist'
      });
    }
    
    const newItem = {
      name,
      description: description || '',
      price: parseFloat(price),
      category: category,
      veg: veg === 'true' || veg === true,
      available: true
    };

    // Upload image to Cloudinary if provided
    if (req.file) {
      try {
        const cloudinary = require('cloudinary').v2;
        
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET
        });

        console.log('☁️ Uploading image to Cloudinary...');

        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'qr-dine/menu-items',
              transformation: [
                { width: 800, height: 800, crop: 'limit' },
                { quality: 'auto' },
                { fetch_format: 'auto' }
              ]
            },
            (error, result) => {
              if (error) {
                console.error('❌ Cloudinary upload error:', error);
                reject(error);
              } else {
                console.log('✅ Image uploaded to Cloudinary');
                resolve(result);
              }
            }
          );
          
          uploadStream.end(req.file.buffer);
        });

        newItem.image = result.secure_url;
        console.log('🖼️ Image URL:', result.secure_url);

      } catch (imgError) {
        console.error('⚠️ Image upload failed:', imgError.message);
      }
    }

    restaurant.menuItems.push(newItem);
    await restaurant.save();

    console.log('✅ Menu item added successfully');

    res.json({
      success: true,
      message: 'Menu item added successfully',
      menuItems: restaurant.menuItems
    });
  } catch (error) {
    console.error('❌ Error adding menu item:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error adding menu item'
    });
  }
});

// @route   PUT /api/menu/item/:itemId
// @desc    Update menu item
// @access  Private
router.put('/item/:itemId', protect, imageUpload.single('image'), async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    const item = restaurant.menuItems.id(req.params.itemId);
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }

    // Update basic fields
    const { name, description, price, category, veg, available } = req.body;
    if (name) item.name = name;
    if (description !== undefined) item.description = description;
    if (price) item.price = parseFloat(price);
    if (category) item.category = category;
    if (veg !== undefined) item.veg = veg === 'true' || veg === true;
    if (available !== undefined) item.available = available === 'true' || available === true;

    // Upload new image if provided
    if (req.file) {
      try {
        const cloudinary = require('cloudinary').v2;
        
        cloudinary.config({
          cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
          api_key: process.env.CLOUDINARY_API_KEY,
          api_secret: process.env.CLOUDINARY_API_SECRET
        });

        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            {
              folder: 'qr-dine/menu-items',
              transformation: [
                { width: 800, height: 800, crop: 'limit' },
                { quality: 'auto' },
                { fetch_format: 'auto' }
              ]
            },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          
          uploadStream.end(req.file.buffer);
        });

        item.image = result.secure_url;
      } catch (imgError) {
        console.error('⚠️ Image upload failed:', imgError.message);
      }
    }

    await restaurant.save();

    res.json({
      success: true,
      message: 'Menu item updated',
      menuItems: restaurant.menuItems
    });
  } catch (error) {
    console.error('Error updating item:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating menu item'
    });
  }
});

// @route   DELETE /api/menu/item/:itemId
// @desc    Delete menu item
// @access  Private
router.delete('/item/:itemId', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);
    restaurant.menuItems.pull(req.params.itemId);
    await restaurant.save();

    res.json({
      success: true,
      message: 'Menu item deleted',
      menuItems: restaurant.menuItems
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error deleting menu item'
    });
  }
});

// @route   POST /api/menu/generate-qr
// @desc    Generate QR code for restaurant
// @access  Private
router.post('/generate-qr', protect, async (req, res) => {
  try {
    const restaurant = await Restaurant.findById(req.restaurant._id);

    // Always generate a brand-new unique code on every regenerate
    const newUniqueCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    restaurant.uniqueCode = newUniqueCode;

    const orderUrl = `${process.env.FRONTEND_URL}/menu/${newUniqueCode}`;
    const qrCodeDataUrl = await generateQR(orderUrl);
    
    restaurant.qrCode = qrCodeDataUrl;
    await restaurant.save();

    res.json({
      success: true,
      qrCode: qrCodeDataUrl,
      orderUrl,
      uniqueCode: newUniqueCode
    });
  } catch (error) {
    console.error('QR generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating QR code'
    });
  }
});

module.exports = router;