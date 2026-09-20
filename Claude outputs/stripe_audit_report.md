# PropBook.pro — Stripe/Paddle Live-Mode Readiness Audit

**Date:** 2026-09-13
**Scope:** `propbook.dev` repo on David's Mac Mini (`/Users/davidsassistant/.openclaw/workspace/projects/propbook.dev`), read-only exploration plus one narrowly-scoped code fix (documented in full below). No Stripe Dashboard access, no Supabase CLI/logs access, no environment or config values were changed.

---

## 1. Stripe Connect (multi-vendor payouts)

**File:** `supabase/functions/stripe-connect/index.ts`

- **Account type:** Stripe Connect **Express**, created via `stripe.accounts.create({ type: "express", country: "US", capabilities: { card_payments, transfers } })`. Onboarding uses **hosted Account Links** (`stripe.accountLinks.create(..., type: "account_onboarding")`) — the browser redirects to Stripe's hosted flow and back, rather than Stripe's embedded Connect Components. `@stripe/connect-js` is in `package.json` but **is not imported anywhere in `src/`** — it's an unused dependency; the embedded-components path was never built.
- **Scoping model:** one Connect account **per property**, not per user. The account ID is stored on `properties.stripe_account_id` (and duplicated onto `profiles.stripe_account_id` for backward-compat lookups).
- **Status display works correctly:** the `GET` handler on `stripe-connect` calls `stripe.accounts.retrieve()` + `stripe.balance.retrieve()` live every time, so the "Charges On / Payouts Pending" badges in `StripeConnectSetup.tsx` are accurate in real time.
- **Bug found — Connect fee/transfer routing never actually activates (fixed, see below).** `create-payment-intent/index.ts` only turns on `application_fee_amount` + `transfer_data.destination` (i.e., only routes money to the host) when `property.stripe_account_status !== "pending"`. But `stripe_account_status` is written to `"pending"` exactly once, at account creation (`stripe-connect/index.ts` lines ~156/163/270/275), and **nothing anywhere in the codebase ever updated it afterward** — there was no `account.updated` handler in the webhook. Result: even after a host fully completes Stripe onboarding and payouts are enabled, every booking payment would still go straight into the **platform's** own Stripe balance instead of the host's connected account, silently, with no error and no visible symptom in the UI (since the UI reads live Stripe data, not this DB field). I fixed the underlying gap — see **Code Fixes** below — but you still need to register the `account.updated` event on the webhook endpoint in the Stripe Dashboard for it to actually fire (see Go-Live Checklist).
- **Suspicious/broken code — manual "payout" action, not fatal but wrong.** In `stripe-connect/index.ts`, the `action: "payout"` handler tries to pull the platform's 2% fee out of the connected account's balance with:
  ```js
  stripe.transfers.create({ amount: fee, currency: "usd", destination: "self" }, { stripeAccount: accountId })
  ```
  `"self"` is not a valid Stripe destination — Stripe has no such account id, so this call will always fail. It's wrapped in `.catch(() => {})`, so it fails silently and the payout still proceeds *without* actually collecting that second fee. Since the booking-time charge already collects the 2% via `application_fee_amount` (destination charges), this manual transfer is redundant *and* broken. I did **not** fix this (see "Not fixed" list below) — it's not blocking payouts, just dead/incorrect code that should probably be deleted rather than patched.
- **What's needed for live payouts:** (1) each property owner must complete Stripe Express onboarding again in **live mode** (test-mode Connect accounts don't carry over); (2) your platform Stripe account itself needs Connect enabled for live mode (business details, complete verification) in the Dashboard; (3) the `account.updated` webhook event needs to be selected on the live-mode webhook endpoint so the fix in this audit actually keeps `stripe_account_status` current.

---

## 2. The webhook that "doesn't work"

**File:** `supabase/functions/stripe-webhook/index.ts` (Supabase Edge Function, `verifyJwt: false`, registered per `.openclaw/AGENTS.md` at `https://jtzagpbdrqfifdisxipr.supabase.co/functions/v1/stripe-webhook`, matching a Stripe webhook endpoint object already on file — `we_1Sf84XK5ECFjIqP3ExMMOWYS` — so a webhook endpoint does exist in the Dashboard; it isn't a case of "never registered").

**Signature verification:** implemented correctly. It reads the raw body with `.text()` (required — parsing JSON first would break the signature check), uses `stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider)` with `Stripe.createSubtleCryptoProvider()` (the correct async/Deno-compatible verification path), and returns 400 with a descriptive error if verification fails. I found no bug in the signature-checking code itself.

**Root cause I found and fixed:** the Connect-status bug described in Section 1. This is a genuine, reproducible bug in the webhook's event coverage (a missing case, not a wrong string or bad await), and it's the most concrete "the webhook doesn't work" explanation I could pin to actual code: the webhook never told your database when a connected account finished onboarding, so downstream logic that depends on that status (fee/transfer routing) silently never engaged.

**Second bug found, not fixed — the webhook's own "trigger deploy" call is broken.** Inside the `checkout.session.completed` case (subscription mode), after saving the subscription to `profiles`, the webhook does:
```js
fetch(`${SUPABASE_URL}/functions/v1/stripe-subscription`, { method: "POST", body: JSON.stringify({ userId, slug }) })
```
with no `action` field. In `stripe-subscription/index.ts`, that falls through to the "deploy action (original flow)" branch, which calls `renderPropertyHtml(...)`. That function references at least seven variables that are **never declared in its scope** — `body`, `heroImage`, `hostName`, `amenities`, `activities`, `localArea`, `gettingThere`, `propertyTitle` (see `supabase/functions/stripe-subscription/index.ts`, the `renderPropertyHtml` function, first bad reference is `body?.email` a few lines in). This throws a `ReferenceError` every single time this code path runs. Because the webhook wraps this fetch in its own `try/catch` (`deployErr` is only logged), **the webhook itself never crashes or fails signature-wise** — but the auto-deploy-on-subscribe path it's trying to trigger always fails silently. I did not fix this: it's a multi-variable rewrite of a whole HTML-templating function, not a one-line fix, and per project memory (`MEMORY.md`) the *actual* current site-creation path for new subscribers goes through the client (`GetSite.tsx` → `save-site-records`), not this webhook-triggered deploy branch — so this dead code path may already be superseded rather than load-bearing. Flagging it precisely rather than guessing at a rewrite.

**What I could not verify (no Dashboard/CLI/log access):**
- Whether `STRIPE_WEBHOOK_SECRET` set as a Supabase Edge Function secret actually matches the signing secret Stripe currently shows for endpoint `we_1Sf84XK5ECFjIqP3ExMMOWYS`. A regenerated/rolled signing secret without an updated Supabase secret is the single most common real-world cause of "webhook doesn't work" and is **completely invisible from the code** — it would show as `Signature verification FAILED` in the function's logs. **David: please check Supabase Dashboard → Edge Functions → stripe-webhook → Logs for this exact line**, and separately check Stripe Dashboard → Developers → Webhooks → this endpoint → "Recent deliveries" for the actual HTTP response codes Stripe is seeing.
- Which specific event types are actually selected on that Dashboard webhook endpoint. The code handles: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`, `payment_intent.succeeded/payment_failed`, `charge.refunded`, and now `account.updated` (after my fix). If the endpoint isn't subscribed to all of these, the corresponding code paths simply never run — with no error anywhere, because Stripe never sends the event.
- Actual delivery success/failure logs (no Supabase CLI on this machine, no dashboard access from this session — `supabase` CLI is not installed and `npx supabase` failed with a registry 403 in this sandboxed environment).

**Resilience note (not fixed, low priority):** the event-handling `switch` block has no enclosing `try/catch`. A transient Supabase error inside any case (e.g. `profiles.update` timing out) would throw, and Deno's `Deno.serve` would return a 500 to Stripe. That's not incorrect — Stripe will retry a 5xx — but it means one flaky DB call produces a generic 500 rather than a clean logged failure. Worth wrapping if you want cleaner logs, not a blocker for going live.

---

## 3. Checkout / payment flow

**File:** `supabase/functions/create-payment-intent/index.ts` (called from `src/components/PaymentForm.tsx` and `src/pages/PaymentPage.tsx`, using `@stripe/react-stripe-js` `PaymentElement` + `stripe.confirmPayment`).

- Bookings use a **PaymentIntent created directly** (`automatic_payment_methods: { enabled: true }`), **not** a Stripe Checkout Session — so the frontend has full control of the flow and the webhook's `payment_intent.succeeded` / `payment_intent.payment_failed` handlers are the correct, consistent counterpart (I confirmed the checkout-session-based subscription flow, which uses `mode: "subscription"`, is a completely separate code path — good, no cross-wiring bug there).
- **Currency:** hardcoded to `"usd"` everywhere I found it (`create-payment-intent`, `stripe-admin`, `stripe-connect`). No multi-currency support exists. Fine if you only operate in USD; flag it if you plan non-US properties.
- **Metadata for webhook reconciliation:** the PaymentIntent is created with `metadata: { bookingId, userId, propertyId, propertyTitle, dates, platformFee, connectedAccountId }`, and the booking row is updated with `stripe_payment_intent_id` **before** the client ever confirms payment. The webhook's `payment_intent.succeeded` case matches purely on `stripe_payment_intent_id` (not on `metadata.bookingId` id lookup) — this is consistent and correct as long as `stripe_payment_intent_id` is reliably saved (it is, synchronously, in the same function call that creates the intent).
- **Connect fee/destination setup:** `application_fee_amount` (2% of the rental subtotal, computed correctly — off `rentalAmount ?? booking.total_price`, before any gross-up) + `transfer_data.destination` (the property's connected account) — this is the standard **destination charge** pattern for Connect and is architecturally correct. The only defect is the always-false gating condition described in Section 1, which I fixed.
- **Refunds:** `process-refund/index.ts` looks correct — retrieves the PaymentIntent, refunds `latest_charge`, and updates the booking. No refund routing logic for Connect application fees (a full refund on a destination charge does automatically reverse the application fee and pull back the transfer in Stripe, so this is fine as-is for full refunds; partial refunds against a Connect destination charge can get more nuanced, but there's no partial-refund UI here so it's moot for now).

---

## 4. Paddle

**Files:** `supabase/functions/paddle-verification/index.ts` (backend only).

Paddle is an **incomplete stub, not a working alternative payment path**:
- `@paddle/paddle-js` is a declared dependency in `package.json` but is **never imported anywhere in `src/`** — no Paddle.js is ever loaded, no Paddle checkout UI exists, nothing in the frontend ever calls `paddle-verification`.
- The one edge function that exists, `paddle-verification`, is a manual "verify a transaction_id you already have" endpoint (calls `GET https://api.paddle.com/transactions/{id}`, checks status is `billed`/`completed`, writes `paddle_subscription_status`/`paddle_plan`/`paddle_transaction_id` onto `profiles`). Nothing currently produces a `transaction_id` for it to verify.
- There is no Paddle **webhook** listener at all (no signature verification, no event handling) — so even if the frontend were wired up, Paddle subscription status changes (cancellations, failed renewals, etc.) would never reach the database; only the one-time initial "verify what I was just charged" call exists.

**Conclusion:** Paddle is not launch-ready and isn't currently reachable by any user flow. Either finish it (Paddle.js checkout + a real Paddle webhook with signature verification) or remove the dead dependency/function before going live to avoid confusion. Not a live-mode blocker for Stripe, but don't advertise Paddle as a working option.

---

## 5. Environment / config audit

I read variable **names and presence/prefix only** — no full secret values appear below or were copied anywhere.

### Frontend (Vite, bundled into the client — found in `src/.env`, referenced via `import.meta.env.*`)
| Variable | Used in | Status on the Mac |
|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | `lib/stripe.ts`, `PaymentForm.tsx`, `GetSite.tsx`, `AdminSidebarBundle.tsx` | **Present**, looks like a **test** key (`pk_test_…` prefix) |
| `VITE_SUPABASE_URL` | app-wide | Present |
| `VITE_SUPABASE_ANON_KEY` | app-wide | Present |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | present in this file, flagged below | Present — **see security note** |

No `VITE_PADDLE_*` variable exists anywhere (consistent with Section 4 — Paddle has no client-side wiring).

### Backend (Supabase Edge Function secrets, referenced via `Deno.env.get(...)` — **not** stored in this repo)
| Variable | Used in | Status |
|---|---|---|
| `STRIPE_SECRET_KEY` | `create-payment-intent`, `process-refund`, `stripe-account`, `stripe-admin`, `stripe-connect`, `stripe-subscription`, `stripe-webhook` | Not directly readable from this machine (Supabase secrets aren't stored locally and the `supabase` CLI isn't installed here, so I could not confirm presence or test/live prefix — **you'll need to check this in the Supabase Dashboard → Edge Functions → Secrets, or via `supabase secrets list` from a machine with the CLI**). |
| `STRIPE_WEBHOOK_SECRET` | `stripe-webhook` only | Same — could not confirm from this machine. **Important:** a copy of a **test-mode** webhook signing secret (`whsec_…`) is written in plaintext inside the project's `MEMORY.md` doc alongside a Cloudflare API token. That's a secrets-hygiene issue worth cleaning up (rotate both and stop storing raw secret values in that doc), independent of the live-mode switch. |
| `PADDLE_SECRET_KEY` | `paddle-verification` only | Could not confirm from this machine. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | all edge functions | Standard Supabase project secrets, presumably present since the functions are deployed and working for non-Stripe features. |
| `HOSTINGER_SSH_PASS` | `stripe-subscription` (deploy path) | Referenced but unrelated to Stripe; not audited further. |

**Security note (not a live-mode blocker, but worth flagging):** `src/.env` contains `VITE_SUPABASE_SERVICE_ROLE_KEY` — a Supabase **service-role key bypasses Row Level Security** and should never be reachable by client code or bundled by Vite (any `VITE_`-prefixed variable is inlined into the browser bundle). Confirm this specific variable is never actually imported/used client-side (I didn't find a `import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY` reference in `src/`, so it may just be sitting unused in the file for reference — but its presence under a `VITE_` prefix in this file is a landmine if anyone ever does reference it from client code).

I found **no live Stripe keys (`sk_live_`)** anywhere in the working tree or in the full git history — clean on that front.

---

## 6. Go-live checklist (specific to what I found in this codebase)

### A. Code changes
1. ✅ **Done in this audit:** added the `account.updated` webhook case to `supabase/functions/stripe-webhook/index.ts` so `properties.stripe_account_status` / `profiles.stripe_account_status` actually update after Connect onboarding — required for booking payments to ever route to hosts. **This file is only modified locally on the Mac (uncommitted, not deployed) — review the diff and deploy it yourself** (`supabase functions deploy stripe-webhook`) once you're happy with it.
2. Register `account.updated` in the Stripe Dashboard's selected events for the webhook endpoint (code alone won't receive the event otherwise).
3. Decide what to do with the broken `renderPropertyHtml` auto-deploy path in `stripe-subscription/index.ts` (Section 2) — either fix the undefined-variable bugs properly, or delete that dead "deploy action (original flow)" branch and the webhook's fetch call to it, since the real deploy flow appears to run through `GetSite.tsx` → `save-site-records` instead.
4. Decide what to do with the broken `destination: "self"` transfer in `stripe-connect`'s manual `payout` action (Section 1) — it's currently harmless (fails silently, no double-fee), but it's dead/wrong code.
5. Either finish or remove the Paddle integration (Section 4) before advertising it as an option.
6. Remove the test-mode "Use test routing number 110000000…" copy from `StripeConnectSetup.tsx` (both `variant="onboarding"` and sidebar variants) before going live — right now it's hardcoded UI text shown to real hosts.
7. Update `stripe-return/index.ts`'s hardcoded fallback (`http://localhost:5174/`) — confirm every caller always passes an explicit `redirect` param in production; the localhost fallback should never be hit but is a landmine if some call site forgets it.

### B. Environment variable swaps
8. Swap `VITE_STRIPE_PUBLISHABLE_KEY` from `pk_test_…` to your live `pk_live_…` key (frontend build env).
9. Swap the Supabase Edge Function secret `STRIPE_SECRET_KEY` from test to live (`sk_live_…`) — do this via Supabase Dashboard or CLI, not by editing this repo.
10. Set `STRIPE_WEBHOOK_SECRET` to the **live-mode** endpoint's signing secret (this will be a *different* `whsec_…` value than the test one — live and test mode each have their own webhook endpoints and secrets in Stripe).
11. Rotate the test-mode webhook secret and the Cloudflare token that are currently sitting in plaintext in the project's `MEMORY.md` doc, and stop writing raw secret values there going forward.
12. If you intend to actually finish Paddle, set `PADDLE_SECRET_KEY` to Paddle's **live** API key (not sandbox) at that time.

### C. Stripe Dashboard configuration
13. Create/confirm a **live-mode** webhook endpoint pointing at `https://jtzagpbdrqfifdisxipr.supabase.co/functions/v1/stripe-webhook` (the test-mode endpoint `we_1Sf84XK5ECFjIqP3ExMMOWYS` does not carry over to live mode — Stripe test and live modes are fully separate).
14. Select these events on that live endpoint: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, and `account.updated` (new, for the fix above).
15. Recreate the live-mode Price objects for every plan in the pricing table in `.openclaw/AGENTS.md` (Starter/Pro/Agency/etc.) — test-mode Price IDs (`price_1TfPVp…` etc., hardcoded in `stripe-subscription/index.ts`) do not exist in live mode; you'll get new `price_...` IDs to hardcode in their place.
16. Enable **Stripe Connect** for live mode on the platform account (complete platform business verification/profile if not already done) — required before any Express account can go live.
17. Complete your platform's own business/tax information, bank account for the 2% platform fee, and payout schedule in Stripe Dashboard settings.
18. Every property owner will need to **redo Express onboarding** in live mode (test-mode Connect accounts are separate objects with no live-mode equivalent).
19. Add propbook.pro's live domain to Stripe Dashboard → Settings → Payment methods → Business details (the `PaymentForm.tsx` diagnostics panel already checks for this — an unauthorized domain causes the Payment Element's iframe to silently fail to render).

### D. Testing David should do himself before flipping the switch
20. Full booking flow in **test mode** first, end-to-end, watching Stripe Dashboard → test mode → Payments and Connect → accounts, to confirm: PaymentIntent created → card confirmed → `payment_intent.succeeded` webhook fires → booking row flips to `paid`/`approved` → (after the fix) the connected account's balance actually shows the transferred amount minus the fee.
21. Complete one full test-mode Express onboarding start-to-finish, then confirm in Supabase that `properties.stripe_account_status` actually flips away from `"pending"` — that's the direct verification that the fix in this audit is working (requires deploying the fix and registering `account.updated` first).
22. Trigger a refund in test mode and confirm the connected account's application-fee reversal shows correctly in Stripe.
23. After swapping to live keys: run one **real, small** live booking (e.g. $1 test property) end-to-end before opening it to real guests, and check Supabase Edge Function logs for `stripe-webhook` immediately after to confirm `✅ Verified event` appears (this is the single fastest way to catch a live-mode webhook-secret mismatch).
24. Re-test the subscription `?paid=true` redirect flow in live mode — `MEMORY.md` records an **unresolved regression report from 2026-09-11** on this exact flow (site/property not appearing after a real Stripe redirect); it's a client-side timing issue in `GetSite.tsx`/`App.tsx`, separate from the webhook, but it directly affects whether new customers' sites get created after they pay, so retest it explicitly before launch.

---

## Summary of code changes made in this audit

**One change, narrowly scoped, not deployed:**
- `supabase/functions/stripe-webhook/index.ts` — added a new `case "account.updated"` in the event-handling `switch` that syncs `properties.stripe_account_status` / `profiles.stripe_account_status` to `"active"` (when both `charges_enabled` and `payouts_enabled` are true) or `"pending"` otherwise, matched by `stripe_account_id`. This does not touch any secret, environment variable, or config value, and does not change behavior for any other event type. A backup of the pre-change file was left at `/tmp/stripe-webhook.index.ts.bak` on the Mac. **This is uncommitted and undeployed** — review it and deploy when ready, and remember to add `account.updated` to the webhook's selected events in the Stripe Dashboard for it to take effect.

**Nothing else in the codebase was modified.**
