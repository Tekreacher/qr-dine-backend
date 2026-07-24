const nodemailer = require('nodemailer');

// Uses Gmail SMTP (or any SMTP) via env vars:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//
// IMPORTANT: Render's outbound network has trouble with IPv6, and Node's DNS
// resolution sometimes returns an IPv6 address for smtp.gmail.com, causing
// ENETUNREACH errors. Forcing `family: 4` makes the connection always use
// IPv4, which fixes this reliably on Render.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 587,
  secure: false,
  requireTLS: true,
  family: 4, // force IPv4 — fixes ENETUNREACH on Render
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 15000
});

/**
 * Send a 6-digit OTP to the restaurant owner's registered email,
 * used to reset their Razorpay Vault password.
 */
async function sendVaultOtpEmail(toEmail, otp, restaurantName) {
  const mailOptions = {
    from: `"QR Dine" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'QR Dine — Razorpay Vault Password Reset OTP',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #3B82F6;">QR Dine</h2>
        <p>Hi ${restaurantName || 'there'},</p>
        <p>You requested to reset your <strong>Razorpay Vault Password</strong>. Use the OTP below to proceed:</p>
        <div style="background: #F0F7FF; border: 1px solid #3B82F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1e293b;">${otp}</span>
        </div>
        <p style="color: #666;">This OTP is valid for <strong>10 minutes</strong>. If you did not request this, please ignore this email — your Razorpay credentials remain secure.</p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">— QR Dine Security Team</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}

module.exports = { sendVaultOtpEmail };
