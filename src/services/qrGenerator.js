const QRCode = require('qrcode');

/**
 * Generate QR code as data URL
 */
async function generateQR(url) {
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(url, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    return qrCodeDataUrl;
  } catch (error) {
    console.error('QR generation error:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate QR code as buffer (for download)
 */
async function generateQRBuffer(url) {
  try {
    const buffer = await QRCode.toBuffer(url, {
      width: 300,
      margin: 2
    });
    
    return buffer;
  } catch (error) {
    console.error('QR generation error:', error);
    throw new Error('Failed to generate QR code');
  }
}

module.exports = { generateQR, generateQRBuffer };