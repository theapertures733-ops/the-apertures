/**
 * THE APERTURES — Backend Server (Razorpay Edition)
 * Node.js + Express + Razorpay + Nodemailer
 *
 * PAYMENT FLOW:
 * 1. Reader clicks Buy Now → modal opens
 * 2. Frontend POSTs to /api/checkout → we create a Razorpay Order
 * 3. Frontend receives order details → opens Razorpay popup
 * 4. Reader pays via UPI / Card / Wallet inside the popup
 * 5. Razorpay returns payment IDs to the browser on success
 * 6. Frontend POSTs those IDs to /api/verify-payment
 * 7. We verify the HMAC signature (cryptographically proves payment is real)
 * 8. On verified → generate one-time download token → email PDF link
 *
 * INSTALL:
 * npm install express razorpay nodemailer dotenv crypto
 */

'use strict';
require('dotenv').config({ path: __dirname + '/.env' });
console.log("KEY ID =", process.env.RAZORPAY_KEY_ID);
console.log("SECRET =", process.env.RAZORPAY_KEY_SECRET);
const express    = require('express');
const Razorpay   = require('razorpay');
const nodemailer = require('nodemailer');
const crypto     = require('crypto');
const path       = require('path');
const fs         = require('fs');

const app = express();

/* ════════════════════════════════════════════════════════
   RAZORPAY CLIENT
   Uses your Key ID + Key Secret from .env
════════════════════════════════════════════════════════ */
const razorpay = new Razorpay({
  key_id:     process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

/* ════════════════════════════════════════════════════════
   BOOK CATALOGUE
   bookId   = the string used in index.html Buy Now buttons
   file     = filename inside /pdfs/ folder on your server
   filename = what the reader sees when they download
   amount   = price in PAISE (₹399 = 39900, ₹499 = 49900)
   currency = always INR for India
════════════════════════════════════════════════════════ */
const BOOKS = {
  'strangers-in-the-dark': {
    title:    'Strangers in the Dark',
    file:     'strangers-in-the-dark.pdf',
    filename: 'The-Apertures-Vol1-Strangers-in-the-Dark.pdf',
    amount:   39900,   // ₹399.00 in paise
    currency: 'INR',
  },
  'quiet-after-chaos': {
    title:    'The Quiet After the Chaos',
    file:     'quiet-after-chaos.pdf',
    filename: 'The-Apertures-Vol2-The-Quiet-After-The-Chaos.pdf',
    amount:   39900,
    currency: 'INR',
  },
  'weight-of-almost': {
    title:    'The Weight of Almost',
    file:     'weight-of-almost.pdf',
    filename: 'The-Apertures-Vol3-The-Weight-Of-Almost.pdf',
    amount:   39900,
    currency: 'INR',
  },
  'glass-at-midnight': {
    title:    'Glass at Midnight',
    file:     'glass-at-midnight.pdf',
    filename: 'The-Apertures-Vol4-Glass-At-Midnight.pdf',
    amount:   49900,   // ₹499.00
    currency: 'INR',
  },
};

/* ════════════════════════════════════════════════════════
   ONE-TIME DOWNLOAD TOKEN STORE
   In-memory Map. Tokens expire in 24 hours and are
   single-use. For production with high volume, swap
   this Map for Redis (same API, just persistent).
════════════════════════════════════════════════════════ */
const downloadTokens = new Map();
// Structure: { token => { bookId, expiresAt, used } }

function createDownloadToken(bookId) {
  const token     = crypto.randomBytes(40).toString('hex');
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  downloadTokens.set(token, { bookId, expiresAt, used: false });
  return token;
}

// Prune expired tokens every hour to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of downloadTokens.entries()) {
    if (data.expiresAt < now) downloadTokens.delete(token);
  }
}, 60 * 60 * 1000);

/* ════════════════════════════════════════════════════════
   EMAIL — Nodemailer via Gmail App Password
   Alternative providers (all free tiers available):
     Resend: resend.com (100 emails/day free)
     SendGrid: sendgrid.com (100/day free)
     Postmark: postmarkapp.com (100/month free)
   Just swap the transport config if you change provider.
════════════════════════════════════════════════════════ */
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_FROM,
    pass: process.env.EMAIL_APP_PASSWORD,
  },
});

async function sendDownloadEmail(toEmail, bookTitle, downloadUrl) {
  const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body{margin:0;padding:0;background:#050505;font-family:Georgia,serif}
  .outer{background:#050505;padding:0}
  .wrap{max-width:520px;margin:0 auto;padding:48px 32px 56px}
  .logo{font-family:Georgia,serif;font-size:11px;letter-spacing:6px;
    text-transform:uppercase;color:#a62b2b;margin-bottom:40px;display:block}
  .divider{height:1px;background:#1a1a1a;margin:28px 0}
  h1{font-size:20px;color:#fdfbf7;font-weight:400;line-height:1.35;margin:0 0 16px}
  h1 em{font-style:italic;color:#b8b8b8}
  .body-txt{font-size:14px;color:#888;line-height:1.85;margin:0 0 32px}
  .body-txt strong{color:#fdfbf7;font-weight:400}
  .btn{
    display:inline-block;background:#a62b2b;color:#fdfbf7 !important;
    text-decoration:none;padding:15px 36px;
    font-family:Georgia,serif;font-size:11px;
    letter-spacing:4px;text-transform:uppercase
  }
  .url-fallback{
    margin-top:20px;font-size:11px;color:#444;line-height:1.7;
    word-break:break-all
  }
  .footer-txt{
    margin-top:48px;font-size:10px;color:#333;
    letter-spacing:1px;text-transform:uppercase;line-height:1.9
  }
</style>
</head>
<body>
<div class="outer">
<div class="wrap">
  <span class="logo">The Apertures</span>
  <div class="divider"></div>
  <h1>Your copy of<br/><em>${bookTitle}</em><br/>is ready.</h1>
  <p class="body-txt">
    Thank you for your purchase. Click the button below to download your PDF.<br/><br/>
    This link is <strong>unique to you</strong> and expires in <strong>24 hours</strong>.
    Download and save your file immediately.
  </p>
  <a class="btn" href="${downloadUrl}">Download Your Book &rarr;</a>
  <p class="url-fallback">
    If the button doesn't work, paste this into your browser:<br/>
    <span style="color:#555">${downloadUrl}</span>
  </p>
  <div class="divider"></div>
  <p class="footer-txt">
    The Apertures &mdash; Cinematic Romance. Uncensored Fantasies.<br/>
    You received this because you purchased ${bookTitle}.<br/>
    Questions? Reply to this email and we'll sort it out.
  </p>
</div>
</div>
</body>
</html>
  `;

  await mailer.sendMail({
    from:    `"The Apertures" <${process.env.EMAIL_FROM}>`,
    to:      toEmail,
    subject: `Your download is ready — ${bookTitle}`,
    html,
  });

  console.log(`[✓] Email sent → ${toEmail} | Book: ${bookTitle}`);
}

/* ════════════════════════════════════════════════════════
   MIDDLEWARE
   IMPORTANT: Razorpay webhook needs raw body.
   We handle it separately with express.raw() FIRST,
   then apply express.json() for all other routes.
════════════════════════════════════════════════════════ */

// Raw body only for the Razorpay webhook route
app.use('/api/webhook/razorpay', express.raw({ type: 'application/json' }));

// JSON parsing for all other routes
app.use(express.json());

// Static frontend
app.use(express.static(path.join(__dirname, '../public')));

/* ════════════════════════════════════════════════════════
   ROUTE 1 — Create Razorpay Order
   POST /api/checkout
   Body: { bookId: "strangers-in-the-dark", email: "x@y.com" }
   Returns: { id, amount, currency, keyId, bookTitle }
════════════════════════════════════════════════════════ */
app.post('/api/checkout', async (req, res) => {
  const { bookId, email } = req.body;

  // Validate inputs
  if (!bookId || !BOOKS[bookId]) {
    return res.status(400).json({ error: 'Invalid book selection' });
  }
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }

  const book = BOOKS[bookId];

  try {
    const order = await razorpay.orders.create({
      amount:   book.amount,      // in paise
      currency: book.currency,
      receipt:  `rcpt_${bookId}_${Date.now()}`,
      notes: {
        bookId,
        email,
        bookTitle: book.title,
      },
    });

    console.log(`[Order Created] ${order.id} | ${book.title} | ${email}`);

    // Send everything the frontend needs to open the Razorpay popup
    res.json({
      id:        order.id,
      amount:    order.amount,
      currency:  order.currency,
      keyId:     process.env.RAZORPAY_KEY_ID,   // public key, safe to send
      bookTitle: book.title,
    });

  } catch (err) {
    console.error('[Order Error]', err.message);
    res.status(500).json({ error: 'Could not create payment order. Please try again.' });
  }
});

/* ════════════════════════════════════════════════════════
   ROUTE 2 — Verify Payment Signature & Deliver PDF
   POST /api/verify-payment
   Body: {
     razorpay_order_id,
     razorpay_payment_id,
     razorpay_signature,
     email,
     bookId
   }

   HOW THE SIGNATURE WORKS:
   Razorpay sends back a HMAC-SHA256 signature that is:
     HMAC_SHA256(order_id + "|" + payment_id, key_secret)
   We compute the same thing server-side and compare.
   If they match → payment is 100% genuine from Razorpay.
   If they don't → someone is trying to fake a payment → reject.
════════════════════════════════════════════════════════ */
app.post('/api/verify-payment', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    email,
    bookId,
  } = req.body;

  // All five fields are required
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !email || !bookId) {
    return res.status(400).json({ success: false, error: 'Missing payment details' });
  }

  const book = BOOKS[bookId];
  if (!book) {
    return res.status(400).json({ success: false, error: 'Invalid book' });
  }

  // ── Signature verification ──
  const payload       = `${razorpay_order_id}|${razorpay_payment_id}`;
  const expectedSig   = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(payload)
    .digest('hex');

  if (expectedSig !== razorpay_signature) {
    // Signatures don't match — reject immediately, do NOT deliver
    console.warn(`[⚠ Signature Mismatch] order=${razorpay_order_id} | payment=${razorpay_payment_id}`);
    return res.status(400).json({ success: false, error: 'Payment verification failed' });
  }

  // ── Signature is valid — generate token & send email ──
  console.log(`[✓ Payment Verified] ${razorpay_payment_id} | ${book.title} | ${email}`);

  try {
    const token       = createDownloadToken(bookId);
    const downloadUrl = `${process.env.BASE_URL}/download/${token}`;
    await sendDownloadEmail(email, book.title, downloadUrl);
    res.json({ success: true });
  } catch (err) {
    console.error('[Delivery Error]', err.message);
    // Payment is verified but email failed.
    // Return 500 so the frontend shows an error with the payment ID,
    // so the reader can contact you to get their book manually.
    res.status(500).json({
      success: false,
      error:   'Payment confirmed but email delivery failed. Contact support.',
      paymentId: razorpay_payment_id,
    });
  }
});

/* ════════════════════════════════════════════════════════
   ROUTE 3 — Razorpay Webhook (optional but recommended)
   POST /api/webhook/razorpay
   Register this URL in: Razorpay Dashboard → Webhooks
   Event to subscribe: payment.captured

   This is a safety net. If the browser closes or crashes
   AFTER payment but BEFORE /api/verify-payment completes,
   the webhook will still fire and deliver the PDF.
   Both routes are idempotent — double-delivery is handled
   by checking a simple in-memory set of processed IDs.
════════════════════════════════════════════════════════ */
const processedPayments = new Set(); // prevent duplicate webhook deliveries

app.post('/api/webhook/razorpay', async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  const signature     = req.headers['x-razorpay-signature'];
  const body          = req.body; // raw buffer (because of express.raw above)

  // ── Verify webhook signature ──
  const expectedSig = crypto
    .createHmac('sha256', webhookSecret)
    .update(body)
    .digest('hex');

  if (expectedSig !== signature) {
    console.warn('[⚠ Webhook Sig Mismatch]');
    return res.status(400).send('Invalid signature');
  }

  let event;
  try {
    event = JSON.parse(body.toString());
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  // Only act on successful captures
  if (event.event !== 'payment.captured') {
    return res.json({ received: true }); // acknowledge but ignore other events
  }

  const payment   = event.payload?.payment?.entity;
  const paymentId = payment?.id;
  const notes     = payment?.notes || {};
  const email     = notes.email;
  const bookId    = notes.bookId;

  if (!paymentId || !email || !bookId || !BOOKS[bookId]) {
    console.warn('[Webhook] Missing notes — cannot deliver. Payment ID:', paymentId);
    return res.json({ received: true });
  }

  // Skip if already processed by /api/verify-payment or a previous webhook
  if (processedPayments.has(paymentId)) {
    console.log(`[Webhook] Already processed: ${paymentId} — skipping`);
    return res.json({ received: true });
  }
  processedPayments.add(paymentId);

  const book = BOOKS[bookId];
  try {
    const token       = createDownloadToken(bookId);
    const downloadUrl = `${process.env.BASE_URL}/download/${token}`;
    await sendDownloadEmail(email, book.title, downloadUrl);
    console.log(`[✓ Webhook Delivered] ${paymentId} | ${book.title} | ${email}`);
  } catch (err) {
    console.error('[Webhook Email Error]', err.message);
    // Don't return non-200 — Razorpay retries webhooks on failure
    // which would cause duplicate deliveries. Log and investigate manually.
  }

  res.json({ received: true });
});

/* ════════════════════════════════════════════════════════
   ROUTE 4 — Serve PDF via one-time token
   GET /download/:token
════════════════════════════════════════════════════════ */
app.get('/download/:token', (req, res) => {
  const { token } = req.params;
  const data      = downloadTokens.get(token);

  if (!data) {
    return res.status(404).send(errorPage(
      'Link Not Found',
      'This download link is invalid or has already expired. Please contact support.'
    ));
  }
  if (data.used) {
    return res.status(410).send(errorPage(
      'Already Downloaded',
      'This link is single-use and has already been used. Reply to your purchase email for support.'
    ));
  }
  if (Date.now() > data.expiresAt) {
    downloadTokens.delete(token);
    return res.status(410).send(errorPage(
      'Link Expired',
      'This link has expired (24-hour limit). Reply to your purchase email and we\'ll send a new one.'
    ));
  }

  const book     = BOOKS[data.bookId];
  const filePath = path.join(__dirname, '../pdfs', book.file);

  if (!fs.existsSync(filePath)) {
    console.error('[Download] File missing from disk:', filePath);
    return res.status(500).send(errorPage(
      'File Not Found',
      'Something went wrong on our end. Please reply to your purchase email and we\'ll fix it immediately.'
    ));
  }

  // Mark as used BEFORE piping (prevents race condition)
  data.used = true;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${book.filename}"`);
  fs.createReadStream(filePath).pipe(res);

  console.log(`[✓ Downloaded] ${book.title} | token ...${token.slice(-8)}`);
});

/* ════════════════════════════════════════════════════════
   ROUTE 5 — Success page
════════════════════════════════════════════════════════ */
app.get('/success', (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Thank You — The Apertures</title>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600&family=EB+Garamond:ital@1&display=swap" rel="stylesheet"/>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{
    background:#050505;color:#fdfbf7;
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:Georgia,serif;text-align:center;padding:40px 24px
  }
  .wrap{max-width:480px}
  .mark{font-size:2rem;margin-bottom:28px;color:#a62b2b}
  h1{font-family:'Cinzel',serif;font-size:1.9rem;font-weight:600;margin-bottom:14px}
  p{font-family:'EB Garamond',serif;font-style:italic;font-size:1.1rem;
    color:#888;line-height:1.8;margin-bottom:32px}
  a{
    display:inline-block;background:#a62b2b;color:#fdfbf7;text-decoration:none;
    padding:13px 32px;font-family:'Cinzel',serif;font-size:.72rem;
    letter-spacing:.22em;text-transform:uppercase
  }
  a:hover{background:#c43535}
</style>
</head>
<body>
<div class="wrap">
  <div class="mark">✦</div>
  <h1>Payment Confirmed.</h1>
  <p>Your book is on its way. Check your inbox — the download link expires in 24 hours, so save your file right away.</p>
  <a href="/">Back to The Library</a>
</div>
</body>
</html>
  `);
});

/* ════════════════════════════════════════════════════════
   HELPER — cinematic error page
════════════════════════════════════════════════════════ */
function errorPage(heading, message) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${heading} — The Apertures</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050505;color:#fdfbf7;min-height:100vh;display:flex;
  align-items:center;justify-content:center;font-family:Georgia,serif;
  text-align:center;padding:40px 24px}
h1{font-size:1.6rem;margin-bottom:16px;color:#a62b2b;letter-spacing:.04em}
p{font-size:.95rem;color:#666;line-height:1.75;max-width:420px}
a{display:inline-block;margin-top:28px;color:#a62b2b;font-size:.75rem;
  letter-spacing:.14em;text-transform:uppercase;text-decoration:none;
  border-bottom:1px solid #a62b2b;padding-bottom:3px}
</style></head><body>
<div><h1>${heading}</h1><p>${message}</p><a href="/">Return to The Apertures</a></div>
</body></html>`;
}

/* ════════════════════════════════════════════════════════
   START
════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  THE APERTURES — Razorpay Edition        ║
║  http://localhost:${PORT}                    ║
║                                          ║
║  Routes:                                 ║
║  POST /api/checkout                      ║
║  POST /api/verify-payment                ║
║  POST /api/webhook/razorpay              ║
║  GET  /download/:token                   ║
╚══════════════════════════════════════════╝
  `);
});
