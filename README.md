# StarryTales Backend

A working backend for the StarryTales bedtime-story subscription: accounts,
Stripe billing, nightly AI-generated stories, and a timezone-aware email
scheduler.

## What's included

- `db/schema.sql` — Postgres schema (users, children, subscriptions, stories)
- `src/routes/auth.js` — signup / login (JWT-based)
- `src/routes/children.js` — add / list / update children (theme, pause)
- `src/routes/stories.js` — story history per child
- `src/routes/stripe.js` — Checkout session creation + webhook handling
- `src/services/claude.js` — generates one story via the Claude API
- `src/services/email.js` — sends the story by email via Resend
- `src/services/scheduler.js` — runs every 15 min, delivers at 6:30 PM local time per subscriber
- `public/index.html` — your marketing site, now wired to the real API
- `public/login.html`, `public/dashboard.html` — parent account management

## 1. Install

```bash
npm install
```

## 2. Set up Postgres

Create a database (locally, or via a host like Render/Railway/Supabase), then:

```bash
cp .env.example .env
# fill in DATABASE_URL and the other values in .env
npm run db:migrate
```

## 3. Set up Stripe

1. Create a Stripe account, then in the Dashboard create a **Product** called
   "StarryTales Nightly Tale" with a recurring **Price** of $9.99/month.
   Copy that Price ID into `STRIPE_PRICE_ID` in `.env`.
2. Copy your API secret key into `STRIPE_SECRET_KEY`.
3. For local testing, install the [Stripe CLI](https://stripe.com/docs/stripe-cli)
   and run:
   ```bash
   stripe listen --forward-to localhost:4000/api/stripe/webhook
   ```
   This prints a webhook signing secret — put it in `STRIPE_WEBHOOK_SECRET`.
   In production, create a webhook endpoint in the Stripe Dashboard pointing
   at `https://your-domain.com/api/stripe/webhook` and use that secret instead.

## 4. Set up the Claude API

Get an API key from https://console.anthropic.com/settings/keys and put it
in `ANTHROPIC_API_KEY`. Test story generation on its own before wiring it
into the nightly flow:

```bash
npm run test-story -- "Amara" space
```

## 5. Set up email

Sign up at https://resend.com, verify your sending domain, and put your API
key in `RESEND_API_KEY`. Set `EMAIL_FROM` to an address on your verified domain.

## 6. Run it

```bash
npm run dev
```

Visit `http://localhost:4000` for the marketing site, sign up, and check
your Postgres tables to confirm the user/child/subscription records were
created. The scheduler starts automatically and will pick up any child whose
local time reaches 6:30 PM.

## 7. Deploy

- Host the app on Render, Railway, or Fly.io — all support long-running
  Node processes, which you need for `node-cron` to keep working (this
  won't work on a serverless platform like plain Vercel functions without
  switching to an external cron trigger).
- Point your domain at the deployed app.
- Update `APP_URL` in your production environment variables.
- Switch `STRIPE_SECRET_KEY` to your live key once you're ready to accept
  real payments, and create a live-mode webhook endpoint + Price ID too
  (test and live mode are separate in Stripe).

## Notes on scale

This scheduler design (poll every 15 minutes, query all active children)
comfortably handles thousands of subscribers. If you grow much larger,
the next step is moving story generation into a queue (e.g., BullMQ) so
sends aren't all processed serially in one process.
