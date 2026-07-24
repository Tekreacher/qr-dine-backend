const nodemailer = require('nodemailer');

/**
 * WHY THIS FILE USES AN HTTP API INSTEAD OF SMTP
 * ----------------------------------------------
 * Render blocks outbound SMTP ports (25, 465, 587) to prevent spam abuse.
 * Connections to smtp.gmail.com time out with ETIMEDOUT no matter what — this
 * is a platform restriction, not a code problem.
 *
 * The solution is to send email over HTTPS (port 443), which is never blocked.
 * We use Brevo's transactional email API for this.
 *
 * Set BREVO_API_KEY + EMAIL_FROM in your environment variables and it just works.
 * If BREVO_API_KEY is absent, we fall back to SMTP — useful for local development
 * or if you ever move to a host that permits SMTP.
 */

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function buildOtpHtml(otp, restaurantName) {
  return `
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
  `;
}

/**
 * Primary path: send over HTTPS via Brevo's API. Works on Render.
 */
async function sendViaBrevo(toEmail, subject, htmlContent) {
  const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER;

  if (!fromEmail) {
    throw new Error('EMAIL_FROM (or SMTP_USER) must be set as the sender address');
  }

  const response = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'QR Dine', email: fromEmail },
      to: [{ email: toEmail }],
      subject,
      htmlContent
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${body}`);
  }

  return response.json();
}

/**
 * Fallback path: classic SMTP. Used only when BREVO_API_KEY is not set
 * (e.g. local development). Will time out on Render — that is expected.
 */
async function sendViaSmtp(toEmail, subject, htmlContent) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    connectionTimeout: 15000
  });

  await transporter.sendMail({
    from: `"QR Dine" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject,
    html: htmlContent
  });
}

/**
 * Send a 6-digit OTP to the restaurant owner's registered email,
 * used to reset their Razorpay Vault password.
 */
async function sendVaultOtpEmail(toEmail, otp, restaurantName) {
  const subject = 'QR Dine — Razorpay Vault Password Reset OTP';
  const htmlContent = buildOtpHtml(otp, restaurantName);

  if (process.env.BREVO_API_KEY) {
    await sendViaBrevo(toEmail, subject, htmlContent);
    console.log(`[email] OTP sent to ${toEmail} via Brevo HTTPS API`);
    return;
  }

  console.warn('[email] BREVO_API_KEY not set — falling back to SMTP (will fail on Render)');
  await sendViaSmtp(toEmail, subject, htmlContent);
  console.log(`[email] OTP sent to ${toEmail} via SMTP`);
}

module.exports = { sendVaultOtpEmail };
