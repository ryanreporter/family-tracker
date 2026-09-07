# Family Tracker

Text-in Budget / Food / Exercise tracker for two people, with a live web dashboard.

## How it works

- **Budget**: 4 editable buckets (name, $ limit, weekly/monthly) plus a topline "Total Budget"
  that always tracks the sum of all bucket spending, edited independently. Texting
  `$50 for Donuts in Dining` logs a $50 transaction against the Dining bucket, deducting
  it from both Dining and the topline total. The text reply reports only the topline
  total remaining for the period (not the individual bucket's remaining).
- **Food**: 2 people, each with an independently editable daily calorie limit. Texting
  `Hamburger and fries for Joe` looks up average calories per item from the USDA
  FoodData Central database (falling back to an AI estimate if a food isn't found) and
  deducts it from Joe's daily total. Texting a bare number (`450 calories`) deducts
  that directly. The "calories remaining today" reply always goes to that person's own
  phone number — Joe's remaining count only ever goes to his number, Hillary's only to
  hers — regardless of who actually sent the text. A person gets a text when they drop
  below 200 calories remaining, and everyone gets a 9pm summary text daily.
- **Exercise**: a simple text-in log per person, listed on the dashboard for reference.
- **Budget alerts**: both phone numbers get a text when the topline total budget drops
  to 25%, 15%, 10%, and 0% remaining for the current period.
- **Dashboard**: one shared web page (protected by a login) both phones can open in a
  browser; it polls every 5 seconds so either person's texts show up for both. Each
  section also has an "Add" form for typing entries directly (useful before your
  Twilio number is verified, or any time texting isn't convenient) — it goes through
  the exact same logic as texting, so thresholds/alerts fire the same way either way.
- Incoming texts are interpreted by Claude (Anthropic API) so phrasing can be loose —
  it classifies the message as budget/calories/exercise and extracts the structured
  fields.

All of this already runs — it just needs credentials and a place to run 24/7. Below is
everything you need to do; nothing here can be done on your behalf (account creation is
something only you can authorize).

## 1. Create accounts / get keys

1. **Twilio** (SMS in/out) — https://www.twilio.com/try-twilio
   - Sign up, buy a phone number with SMS capability (~$1.15/mo).
   - From the Twilio Console, copy your **Account SID** and **Auth Token**.
2. **Anthropic API key** (text parsing) — https://console.anthropic.com/
   - Sign up, create an API key. Usage here is tiny (a few short calls/day), well
     under a dollar a month.
3. **USDA FoodData Central API key** (calorie lookups, free, instant) —
   https://fdc.nal.usda.gov/api-key-signup.html
4. **A host to run this 24/7** — pick one:
   - [Render](https://render.com) — "Web Service" (Starter plan, ~$7/mo, needed for
     an always-on instance and a persistent disk for the database file).
   - [Railway](https://railway.app) — similar usage-based pricing.
   - Any VPS or an always-on machine you own (see "Self-hosting" below).

## 2. Configure

Copy `.env.example` to `.env` and fill in every value: the Twilio SID/token/number,
the Anthropic key, the USDA key, and a `DASHBOARD_USER`/`DASHBOARD_PASS` you choose
(this protects your budget/health data — the dashboard URL will otherwise be public).

`JOE_PHONE` and `HILLARY_PHONE` are already defaulted to the numbers you gave
(773-531-6716 and 708-951-3283) in E.164 format — adjust if wrong.

## 3. Run it

```bash
npm install
npm start
```

This starts the web server (dashboard + API) and the SMS webhook on the port from
`.env` (default 3000), and starts the 9pm-summary / low-calorie-check schedules.

## 4. Point Twilio at your webhook

Once deployed (see below) you'll have a public HTTPS URL, e.g.
`https://your-app.onrender.com`. In the Twilio Console, open your phone number's
settings and set **"A message comes in"** to a webhook:

```
https://your-app.onrender.com/sms
```

Method: `HTTP POST`.

## 5. Deploy

**Render**: create a new "Web Service" from this repo, set the build command to
`npm install` and start command to `npm start`, add a persistent disk (e.g. 1GB
mounted at `/data`) and set `DATABASE_PATH=/data/family-tracker.db`, then add all the
`.env` values as environment variables in the dashboard.

**Railway**: similar — new project from repo, add a volume, set the same environment
variables.

**Self-hosting**: run `npm start` on a machine that's always on and always connected
(a Mac mini, an old PC, a Raspberry Pi), and either give it a static IP + port
forwarding + a domain, or use a tunnel service (e.g. Cloudflare Tunnel or ngrok) to get
a stable public HTTPS URL for the Twilio webhook.

## 6. Try it

Text your Twilio number from Joe's or Hillary's phone:

- `$50 for Donuts in Dining`
- `Hamburger and fries for Joe`
- `300 calories`
- `Ran 3 miles`

Then open `https://your-app.../` in a phone browser (log in with the dashboard
user/pass) to see it reflected — from both phones, regardless of who texted it in.

## Adjusting things later

Bucket names/limits/timeframes and daily calorie limits are edited directly on the
dashboard — no code changes or redeploys needed for that. Code changes (e.g. changing
which two people/numbers are wired in) require editing `.env` and redeploying.
