# The Apertures — Razorpay Setup Guide

## Project Structure
```
apertures/
├── public/
│   └── index.html          ← Complete frontend (Razorpay JS embedded)
├── backend/
│   └── server.js           ← Node.js + Express + Razorpay backend
├── pdfs/                   ← YOUR PDF FILES GO HERE (never publicly accessible)
│   ├── strangers-in-the-dark.pdf
│   ├── quiet-after-chaos.pdf
│   ├── weight-of-almost.pdf
│   └── glass-at-midnight.pdf
├── .env                    ← Your secrets (NEVER commit to git)
├── .env.example            ← Template (safe to share)
└── package.json
```

---

## Payment Flow (How It Works)

```
Reader clicks Buy Now
       ↓
Modal opens → reader enters email
       ↓
Frontend → POST /api/checkout → backend creates Razorpay Order
       ↓
Razorpay popup opens → reader pays (UPI / Card / Wallet)
       ↓
Razorpay returns 3 IDs to the browser on success
       ↓
Frontend → POST /api/verify-payment → backend verifies HMAC signature
       ↓
Signature valid → generate one-time token → email PDF link
       ↓
Reader gets email → clicks link → PDF downloads → link is burned
       ↓ (safety net)
Razorpay also fires webhook → /api/webhook/razorpay
If browser crashed before verify-payment completed, webhook delivers anyway
```

---

## Local Testing Checklist (Do These in Order)

### 1. Prerequisites
```bash
node --version    # must be v18 or higher
npm --version     # must be v8 or higher
```
If not installed: nodejs.org → download LTS version.

### 2. Install dependencies
```bash
cd apertures
npm install
```

### 3. Get Razorpay TEST keys
- Go to dashboard.razorpay.com → sign up free
- Settings → API Keys → Generate Test Key
- You get: Key ID (starts with `rzp_test_`) and Key Secret
- DO NOT use Live keys yet — test keys never charge real money

### 4. Set up Gmail App Password
- Go to myaccount.google.com → Security
- Enable 2-Step Verification (required)
- Search for "App Passwords" → create one, name it "Apertures"
- Copy the 16-character password shown (you only see it once)

### 5. Create your .env file
```bash
cp .env.example .env
```
Open .env and fill in:
```
RAZORPAY_KEY_ID=rzp_test_yourActualKeyId
RAZORPAY_KEY_SECRET=yourActualKeySecret
RAZORPAY_WEBHOOK_SECRET=any_random_string_for_now
EMAIL_FROM=youremail@gmail.com
EMAIL_APP_PASSWORD=your 16 char app password
BASE_URL=http://localhost:3000
PORT=3000
```

### 6. Add placeholder PDFs for testing
```bash
mkdir -p pdfs
echo "test" > pdfs/strangers-in-the-dark.pdf
echo "test" > pdfs/quiet-after-chaos.pdf
echo "test" > pdfs/weight-of-almost.pdf
echo "test" > pdfs/glass-at-midnight.pdf
```
(Replace with real PDFs before launch)

### 7. Start the server
```bash
npm run dev
```
Open http://localhost:3000 — you should see the website.

### 8. Test a purchase (uses Razorpay TEST mode — no real money)
- Click any "Buy Now" button
- Enter your real email
- Razorpay popup opens
- Use test UPI ID: `success@razorpay`
- Or test card: 4111 1111 1111 1111 | any future date | any CVV
- After payment — check your inbox for the download email

### 9. Test the download link
- Click the link in the email
- PDF should download
- Click same link again — should say "Already Downloaded"

### 10. Test webhook locally (optional but recommended)
Razorpay can't hit localhost directly — use their test dashboard instead:
- Razorpay Dashboard → Webhooks → Test → payment.captured
- Or skip this and only test after you deploy to Railway

---

## Deploy to Railway.app (Free Tier)

### Step 1 — Push code to GitHub
```bash
git init
echo ".env" >> .gitignore
echo "pdfs/" >> .gitignore     ← PDFs should NOT go to GitHub
git add .
git commit -m "The Apertures — launch"
# Create a repo on github.com, then:
git remote add origin https://github.com/yourusername/apertures.git
git push -u origin main
```

### Step 2 — Deploy on Railway
1. Go to railway.app → Log in with GitHub → New Project
2. Deploy from GitHub repo → select your repo
3. Railway detects Node.js automatically
4. Go to your service → Variables tab → Add all 6 env variables
5. Railway gives you a URL like `https://apertures-xyz.up.railway.app`
6. Update BASE_URL in Railway variables to match this URL

### Step 3 — Register Razorpay Webhook
1. Switch to LIVE keys in .env and Railway variables
2. Razorpay Dashboard → Settings → Webhooks → Add New Webhook
3. URL: `https://your-railway-url.up.railway.app/api/webhook/razorpay`
4. Events: tick `payment.captured`
5. Set the Webhook Secret → copy it → put in RAZORPAY_WEBHOOK_SECRET

### Step 4 — Upload your real PDFs
PDFs should NOT go to GitHub (too large, too risky).
On Railway: use a Volume, or better, store PDFs on an S3 bucket and
serve them via signed URLs. For a small operation (< 50 sales/day),
just Railway volume storage works fine.

---

## Adding New Books

1. Add entry to BOOKS object in server.js
2. Add a new card in index.html (copy any existing card, update onclick params)
3. Put the PDF in /pdfs/
4. Redeploy (just `git push` if connected to Railway)

---

## Pricing Reference (India)

| Format | INR | Paise in code |
|---|---|---|
| Short story | ₹199 | 19900 |
| Short erotica | ₹299–₹399 | 29900–39900 |
| Novella | ₹399–₹599 | 39900–59900 |
| Full novel | ₹599–₹899 | 59900–89900 |
| Bundle (3 books) | ₹999 | 99900 |

## Security Notes
- PDFs live outside /public/ — readers cannot access them directly
- Every download token is 80 hex chars (40 random bytes) — unguessable
- Tokens are single-use + expire in 24 hours
- Payment signature is verified server-side with HMAC-SHA256
- You never touch card numbers — Razorpay handles all of that
- Webhook has its own signature verification — can't be faked
