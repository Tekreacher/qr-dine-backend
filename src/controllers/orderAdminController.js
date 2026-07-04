const Order = require('../models/Order');
const ExcelJS = require('exceljs');

// @desc    Get all orders for restaurant
// @route   GET /api/admin/orders
// @access  Private (Restaurant)



exports.getRestaurantOrders = async (req, res) => {
  try {
    const { status, startDate, endDate } = req.query;
    
    const query = { restaurantId: req.restaurant._id };
    
    if (status && status !== 'all') {
      query.orderStatus = status;
    }
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    console.log(`📋 Found ${orders.length} orders for restaurant ${req.restaurant.name}`);

    res.json({
      success: true,
      count: orders.length,
      orders
    });
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching orders'
    });
  }
};

// @desc    Mark order as ready
// @route   PUT /api/admin/orders/:orderId/ready
// @access  Private (Restaurant)

const { sendOrderReadySMS } = require('../services/notificationService');

exports.markOrderReady = async (req, res) => {
  try {
    const order = await Order.findOne({
      _id: req.params.orderId,
      restaurantId: req.restaurant._id
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.isReady = true;
    order.orderStatus = 'ready';
    order.readyAt = new Date();
    
    await order.save();

    console.log(`✅ Order ${order._id} marked as ready`);

    // Send SMS notification
    if (order.customerPhone) {
      const orderNumber = order._id.toString().slice(-6).toUpperCase();
      await sendOrderReadySMS(
        order.customerPhone,
        req.restaurant.name,
        orderNumber
      );
    }

    res.json({
      success: true,
      message: 'Order marked as ready and customer notified',
      order
    });
  } catch (error) {
    console.error('❌ Error marking order ready:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order'
    });
  }
};









// @desc    Update order status
// @route   PUT /api/admin/orders/:orderId/status
// @access  Private (Restaurant)
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const validStatuses = ['received', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const order = await Order.findOne({
      _id: req.params.orderId,
      restaurantId: req.restaurant._id
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    order.orderStatus = status;
    
    // Auto-mark as ready when status is 'ready'
    if (status === 'ready' && !order.isReady) {
      order.isReady = true;
      order.readyAt = new Date();
    }

    await order.save();

    console.log(`✅ Order ${order._id} status updated to ${status}`);

    res.json({
      success: true,
      order
    });
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating order status'
    });
  }
};

// @desc    Get order analytics
// @route   GET /api/admin/orders/analytics
// @access  Private (Restaurant)
exports.getAnalytics = async (req, res) => {
  try {
    const { period = 'day' } = req.query;
    
    const now = new Date();
    let startDate;
    
    switch(period) {
      case 'week':
        startDate = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'month':
        startDate = new Date(now.setMonth(now.getMonth() - 1));
        break;
      default:
        startDate = new Date(now.setHours(0, 0, 0, 0));
    }

    const orders = await Order.find({
      restaurantId: req.restaurant._id,
      createdAt: { $gte: startDate },
      paymentStatus: 'paid'
    });

    const totalRevenue = orders.reduce((sum, order) => sum + order.totalAmount, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Group by date
    const ordersByDate = orders.reduce((acc, order) => {
      const date = order.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { count: 0, revenue: 0 };
      }
      acc[date].count++;
      acc[date].revenue += order.totalAmount;
      return acc;
    }, {});

    console.log(`📊 Analytics for ${period}: ${totalOrders} orders, ₹${totalRevenue} revenue`);

    res.json({
      success: true,
      analytics: {
        totalRevenue,
        totalOrders,
        avgOrderValue,
        ordersByDate,
        period
      }
    });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching analytics'
    });
  }
};

// @desc    Export orders to Excel
// @route   GET /api/admin/orders/export
// @access  Private (Restaurant)
exports.exportOrders = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const query = { restaurantId: req.restaurant._id };
    
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    // Add headers
    worksheet.columns = [
      { header: 'Order ID', key: 'orderId', width: 25 },
      { header: 'Date', key: 'date', width: 20 },
      { header: 'Customer Name', key: 'customerName', width: 20 },
      { header: 'Customer Phone', key: 'customerPhone', width: 15 },
      { header: 'Table Number', key: 'tableNumber', width: 12 },
      { header: 'Items', key: 'items', width: 40 },
      { header: 'Total Amount', key: 'totalAmount', width: 15 },
      { header: 'Payment Status', key: 'paymentStatus', width: 15 },
      { header: 'Order Status', key: 'orderStatus', width: 15 }
    ];

    // Add data
    orders.forEach(order => {
      worksheet.addRow({
        orderId: order._id.toString(),
        date: order.createdAt.toLocaleString(),
        customerName: order.customerName || 'N/A',
        customerPhone: order.customerPhone || 'N/A',
        tableNumber: order.tableNumber,
        items: order.items.map(i => `${i.name} x${i.quantity}`).join(', '),
        totalAmount: `₹${order.totalAmount}`,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus
      });
    });

    // Style header
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' }
    };

    // Set response headers
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=orders-${Date.now()}.xlsx`
    );

    // Write to response
    await workbook.xlsx.write(res);
    res.end();

    console.log(`📥 Exported ${orders.length} orders to Excel`);
  } catch (error) {
    console.error('❌ Export error:', error);
    res.status(500).json({
      success: false,
      message: 'Error exporting orders'
    });
  }
};

module.exports = exports;