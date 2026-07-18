const Order = require('../models/Order');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

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

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    } else {
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

    if (format === 'pdf') {
      return generatePDF(orders, restaurantName, startDate, endDate, res);
    }

    return generateExcel(orders, restaurantName, startDate, endDate, res);

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ success: false, message: 'Error exporting orders' });
  }
};

// ── EXCEL GENERATION ──
async function generateExcel(orders, restaurantName, startDate, endDate, res) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QR Dine';
  const ws = workbook.addWorksheet('Sales Report');

  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = `${restaurantName} — Sales Report`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.mergeCells('A2:I2');
  const fromDate = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'All time';
  const toDate = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'All time';
  ws.getCell('A2').value = `Period: ${fromDate} to ${toDate}`;
  ws.getCell('A2').alignment = { horizontal: 'center' };
  ws.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };

  ws.addRow([]);

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

  const headerRow = ws.getRow(4);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
  headerRow.height = 20;

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

    if (order.paymentStatus === 'paid') {
      row.getCell('paymentStatus').font = { color: { argb: 'FF16A34A' } };
    } else {
      row.getCell('paymentStatus').font = { color: { argb: 'FFDC2626' } };
    }
  });

  ws.addRow([]);
  const totalRow = ws.addRow({
    orderId: 'TOTAL',
    customerName: `${orders.length} orders`,
    totalAmount: totalRevenue
  });
  totalRow.font = { bold: true };
  totalRow.getCell('totalAmount').font = { bold: true, color: { argb: 'FF3B82F6' } };

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
}

// ── PDF GENERATION ──
function generatePDF(orders, restaurantName, startDate, endDate, res) {
  const doc = new PDFDocument({ margin: 40, size: 'A4', layout: 'landscape' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=sales-report-${Date.now()}.pdf`);
  doc.pipe(res);

  const fromDate = startDate ? new Date(startDate).toLocaleDateString('en-IN') : 'All time';
  const toDate = endDate ? new Date(endDate).toLocaleDateString('en-IN') : 'All time';

  // Header
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1e293b').text(restaurantName, { align: 'center' });
  doc.fontSize(14).font('Helvetica').fillColor('#3B82F6').text('Sales Report', { align: 'center' });
  doc.fontSize(10).fillColor('#666666').text(`Period: ${fromDate} to ${toDate}`, { align: 'center' });
  doc.moveDown(1);

  // Summary boxes
  const totalRevenue = orders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.totalAmount, 0);
  const totalOrders = orders.length;
  const paidOrders = orders.filter(o => o.paymentStatus === 'paid').length;

  const boxY = doc.y;
  const boxWidth = 160;
  const gap = 20;

  const summaryBoxes = [
    { label: 'Total Orders', value: totalOrders },
    { label: 'Paid Orders', value: paidOrders },
    { label: 'Total Revenue', value: `Rs. ${totalRevenue.toFixed(0)}` },
    { label: 'Avg Order Value', value: `Rs. ${totalOrders > 0 ? (totalRevenue / paidOrders || 0).toFixed(0) : 0}` }
  ];

  summaryBoxes.forEach((box, i) => {
    const x = 40 + i * (boxWidth + gap);
    doc.roundedRect(x, boxY, boxWidth, 50, 6).fillAndStroke('#F0F7FF', '#3B82F6');
    doc.fontSize(9).fillColor('#666666').text(box.label, x + 10, boxY + 8, { width: boxWidth - 20 });
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1e293b').text(String(box.value), x + 10, boxY + 24, { width: boxWidth - 20 });
    doc.font('Helvetica');
  });

  doc.y = boxY + 70;
  doc.moveDown(1);

  // Table header
  const tableTop = doc.y;
  const colWidths = { date: 90, customer: 100, table: 45, items: 260, amount: 70, status: 60 };
  let x = 40;

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF');
  doc.rect(40, tableTop, 720, 22).fill('#3B82F6');
  doc.fillColor('#FFFFFF');

  doc.text('Date & Time', x + 5, tableTop + 6, { width: colWidths.date }); x += colWidths.date;
  doc.text('Customer', x + 5, tableTop + 6, { width: colWidths.customer }); x += colWidths.customer;
  doc.text('Table', x + 5, tableTop + 6, { width: colWidths.table }); x += colWidths.table;
  doc.text('Items', x + 5, tableTop + 6, { width: colWidths.items }); x += colWidths.items;
  doc.text('Amount', x + 5, tableTop + 6, { width: colWidths.amount }); x += colWidths.amount;
  doc.text('Status', x + 5, tableTop + 6, { width: colWidths.status });

  let y = tableTop + 22;
  doc.font('Helvetica').fontSize(8);

  orders.forEach((order, i) => {
    if (y > 500) {
      doc.addPage({ margin: 40, size: 'A4', layout: 'landscape' });
      y = 40;
    }

    const rowColor = i % 2 === 0 ? '#FFFFFF' : '#F8FAFC';
    doc.rect(40, y, 720, 20).fill(rowColor);
    doc.fillColor('#1e293b');

    let cx = 40;
    doc.text(new Date(order.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), cx + 5, y + 5, { width: colWidths.date }); cx += colWidths.date;
    doc.text(order.customerName || 'Guest', cx + 5, y + 5, { width: colWidths.customer }); cx += colWidths.customer;
    doc.text(String(order.tableNumber || '-'), cx + 5, y + 5, { width: colWidths.table }); cx += colWidths.table;
    doc.text((order.items?.map(it => `${it.name} x${it.quantity}`).join(', ') || '-').slice(0, 80), cx + 5, y + 5, { width: colWidths.items }); cx += colWidths.items;
    doc.text(`Rs. ${order.totalAmount?.toFixed(0)}`, cx + 5, y + 5, { width: colWidths.amount }); cx += colWidths.amount;
    doc.fillColor(order.paymentStatus === 'paid' ? '#16A34A' : '#DC2626');
    doc.text(order.paymentStatus, cx + 5, y + 5, { width: colWidths.status });
    doc.fillColor('#1e293b');

    y += 20;
  });

  // Total row
  doc.rect(40, y, 720, 24).fill('#DBEAFE');
  doc.fillColor('#1e293b').font('Helvetica-Bold').fontSize(10);
  doc.text(`TOTAL (${orders.length} orders)`, 45, y + 6, { width: 400 });
  doc.text(`Rs. ${totalRevenue.toFixed(0)}`, 40 + colWidths.date + colWidths.customer + colWidths.table + colWidths.items + 5, y + 6, { width: colWidths.amount });

  doc.end();
}

module.exports = exports;
