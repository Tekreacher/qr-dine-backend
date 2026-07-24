const dns = require('dns').promises;
const nodemailer = require('nodemailer');

/**
 * WHY THIS FILE LOOKS LIKE THIS
 * -----------------------------
 * Render's outbound network cannot reach IPv6. Nodemailer (v6.7+) performs its
 * OWN internal DNS resolution before connecting — it does not use Node's
 * dns.lookup(). That means neither `dns.setDefaultResultOrder('ipv4first')` nor
 * the socket-level `family: 4` option can influence it, and it kept resolving
 * smtp.gmail.com to an IPv6 address → ENETUNREACH.
 *
 * The fix: resolve the IPv4 (A record) ourselves and pass the literal IP as the
 * host. Nodemailer sees an IP and skips DNS entirely. We then set
 * `tls.servername` to the real hostname so the TLS certificate still validates.
 */

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';

// Cache the resolved IP so we don't hit DNS on every single email
let cachedIp = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000; // 10 minutes

async function resolveIpv4(hostname) {
  const now = Date.now();
  if (cachedIp && now - cachedAt < CACHE_MS) return cachedIp;

  const addresses = await dns.resolve4(hostname); // A records only — never IPv6
  if (!addresses || addresses.length === 0) {
    throw new Error(`Could not resolve an IPv4 address for ${hostname}`);
  }
  cachedIp = addresses[0];
  cachedAt = now;
  return cachedIp;
}

/**
 * Build a transporter pointed at a literal IPv4 address.
 * port 587 => STARTTLS (secure: false), port 465 => implicit SSL (secure: true)
 */
function buildTransporter(ip, port) {
  return nodemailer.createTransport({
    host: ip,                 // literal IP — no DNS lookup happens
    port,
    secure: port === 465,
    requireTLS: port === 587,
    tls: {
      servername: SMTP_HOST   // validate cert against the real hostname
    },
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000
  });
}

function buildOtpMail(toEmail, otp, restaurantName) {
  return {
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
}

/**
 * Send a 6-digit OTP to the restaurant owner's registered email.
 * Tries port 587 (STARTTLS) first, then falls back to 465 (SSL).
 */
async function sendVaultOtpEmail(toEmail, otp, restaurantName) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    throw new Error('SMTP_USER / SMTP_PASS are not set in environment variables');
  }

  const ip = await resolveIpv4(SMTP_HOST);
  console.log(`[email] ${SMTP_HOST} resolved to IPv4 ${ip}`);

  const mail = buildOtpMail(toEmail, otp, restaurantName);

  // Try the configured/default port first, then the other one as fallback.
  const primaryPort = Number(process.env.SMTP_PORT) || 587;
  const fallbackPort = primaryPort === 587 ? 465 : 587;

  try {
    await buildTransporter(ip, primaryPort).sendMail(mail);
    console.log(`[email] OTP sent to ${toEmail} via port ${primaryPort}`);
  } catch (err) {
    console.error(`[email] Port ${primaryPort} failed (${err.code || err.message}). Trying ${fallbackPort}...`);
    await buildTransporter(ip, fallbackPort).sendMail(mail);
    console.log(`[email] OTP sent to ${toEmail} via fallback port ${fallbackPort}`);
  }
}

module.exports = { sendVaultOtpEmail };
