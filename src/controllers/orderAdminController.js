const Order = require('../models/Order');
const ExcelJS = require('exceljs');

// @desc    Get all orders for restaurant with date filter
// @route   GET /api/admin/orders
exports.getRestaurantOrders = async (req, res) => {
  try {
    const { status, startDate, endDate, limit = 200 } = req.query;
    const query = { restaurantId: req.restaurant._id };

    if (status && status !== 'all') query.orderStatus = status;

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.find(query).sort({ createdAt: -1 }).limit(Number(limit));

    res.json({ success: true, count: orders.length, orders });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
};

// @desc    Mark order as ready
// @route   PUT /api/admin/orders/:orderId/ready
const { sendOrderReadySMS } = require('../services/notificationService');

exports.markOrderReady = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: req.restaurant._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.isReady = true;
    order.orderStatus = 'ready';
    order.readyAt = new Date();
    await order.save();

    if (order.customerPhone) {
      const orderNumber = order._id.toString().slice(-6).toUpperCase();
      await sendOrderReadySMS(order.customerPhone, req.restaurant.name, orderNumber);
    }

    res.json({ success: true, message: 'Order marked as ready', order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating order' });
  }
};

// @desc    Update order status
// @route   PUT /api/admin/orders/:orderId/status
exports.updateOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['received', 'preparing', 'ready', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const order = await Order.findOne({ _id: req.params.orderId, restaurantId: req.restaurant._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

    order.orderStatus = status;
    if (status === 'ready' && !order.isReady) {
      order.isReady = true;
      order.readyAt = new Date();
    }
    await order.save();

    res.json({ success: true, order });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error updating order status' });
  }
};

// @desc    Get analytics — supports startDate/endDate OR period
// @route   GET /api/admin/orders/analytics
exports.getAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query;

    const query = {
      restaurantId: req.restaurant._id,
      paymentStatus: 'paid'
    };

    // If explicit dates passed, use them (from calendar)
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    } else {
      // Fall back to period
      const now = new Date();
      let start;
      if (period === 'week') start = new Date(now.setDate(now.getDate() - 7));
      else if (period === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1);
      else { start = new Date(); start.setHours(0, 0, 0, 0); }
      query.createdAt = { $gte: start };
    }

    const orders = await Order.find(query);

    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const totalOrders = orders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Group by date
    const ordersByDate = orders.reduce((acc, order) => {
      const date = order.createdAt.toISOString().split('T')[0];
      if (!acc[date]) acc[date] = { count: 0, revenue: 0 };
      acc[date].count++;
      acc[date].revenue += order.totalAmount;
      return acc;
    }, {});

    res.json({
      success: true,
      analytics: { totalRevenue, totalOrders, avgOrderValue, ordersByDate, period }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching analytics' });
  }
};

// @desc    Export orders to Excel or PDF
// @route   GET /api/admin/orders/export
exports.exportOrders = async (req, res) => {
  try {
    const { startDate, endDate, format = 'excel' } = req.query;
    const query = { restaurantId: req.restaurant._id };

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const orders = await Order.find(query).sort({ createdAt: 1 });
    const restaurantName = req.restaurant.name;

    // ── EXCEL EXPORT ──
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'QR Dine';
    const ws = workbook.addWorksheet('Sales Report');

    // Title row
    ws.mergeCells('A1:I1');
    ws.getCell('A1').value = `${restaurantName} — Sales Report`;
    ws.getCell('A1').font = { bold: true, size: 14 };
    ws.getCell('A1').alignment = { horizontal: 'center' };

    // Date range row
    ws.mergeCells('A2:I2');
    const fromDate = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'All time';
    const toDate = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'All time';
    ws.getCell('A2').value = `Period: ${fromDate} to ${toDate}`;
    ws.getCell('A2').alignment = { horizontal: 'center' };
    ws.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

    ws.addRow([]); // blank row

    // Headers
    ws.columns = [
      { header: 'Order ID', key: 'orderId', width: 20 },
      { header: 'Date & Time', key: 'date', width: 22 },
      { header: 'Customer', key: 'customerName', width: 20 },
      { header: 'Phone', key: 'customerPhone', width: 16 },
      { header: 'Table', key: 'tableNumber', width: 8 },
      { header: 'Items', key: 'items', width: 45 },
      { header: 'Amount (₹)', key: 'totalAmount', width: 14 },
      { header: 'Payment', key: 'paymentStatus', width: 14 },
      { header: 'Status', key: 'orderStatus', width: 14 }
    ];

    // Style header row (row 4)
    const headerRow = ws.getRow(4);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    headerRow.height = 20;

    // Data rows
    let totalRevenue = 0;
    orders.forEach(order => {
      const amount = order.totalAmount || 0;
      if (order.paymentStatus === 'paid') totalRevenue += amount;

      const row = ws.addRow({
        orderId: order._id.toString().slice(-8).toUpperCase(),
        date: new Date(order.createdAt).toLocaleString('en-IN'),
        customerName: order.customerName || 'Guest',
        customerPhone: order.customerPhone || '-',
        tableNumber: order.tableNumber || '-',
        items: order.items?.map(i => `${i.name} x${i.quantity}`).join(', ') || '-',
        totalAmount: amount,
        paymentStatus: order.paymentStatus,
        orderStatus: order.orderStatus
      });

      // Color paid/unpaid
      if (order.paymentStatus === 'paid') {
        row.getCell('paymentStatus').font = { color: { argb: 'FF16A34A' } };
      } else {
        row.getCell('paymentStatus').font = { color: { argb: 'FFDC2626' } };
      }
    });

    // Total row
    ws.addRow([]);
    const totalRow = ws.addRow({
      orderId: 'TOTAL',
      customerName: `${orders.length} orders`,
      totalAmount: totalRevenue
    });
    totalRow.font = { bold: true };
    totalRow.getCell('totalAmount').font = { bold: true, color: { argb: 'FF3B82F6' } };

    // Border all cells
    ws.eachRow((row, rowNumber) => {
      if (rowNumber >= 4) {
        row.eachCell(cell => {
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
            right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
          };
        });
      }
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=sales-report-${Date.now()}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Error exporting orders' });
  }
};

module.exports = exports;
