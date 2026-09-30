# Architecture

## Components

| Component | Where | Responsibility |
|---|---|---|
| Marketing site + owner panel + operator panel | Vercel (static, no build step) | Sign-up, WhatsApp connection, day-to-day management |
| API | Railway, Node.js + Express | Webhook processing, AI, admin API, billing, schedulers |
| Database | Railway PostgreSQL | Tenants, users, messages, orders, appointments, catalog, audit log |
| WhatsApp | Meta Cloud API (official) | Receive and send messages, media, Embedded Signup |
| AI | OpenAI, Groq | Replies, order and booking extraction, audio transcription |
| Billing | Mercado Pago subscriptions | Hosted checkout, recurring charges, status webhooks |

## Message lifecycle

```mermaid
sequenceDiagram
  participant C as Customer
  participant M as Meta Cloud API
  participant W as /webhook
  participant AI as AI cascade
  participant DB as PostgreSQL
  C->>M: "2 calabresa pizzas for delivery"
  M->>W: POST (X-Hub-Signature-256)
  W->>W: validate HMAC, answer 200 fast
  W->>W: dedupe message id, rate limit per tenant, debounce bursts
  W->>DB: resolve tenant by phone_number_id, load history + menu
  W->>AI: prompt (business tone + menu + history)
  AI-->>W: reply (+ structured order when detected)
  W->>DB: save message, order (duplicate-protected)
  W->>M: send reply
  M->>C: "Got it! 2 calabresa pizzas, R$ 109.80 + delivery..."
```

If every AI attempt fails, the customer still gets a safe canned reply, so nobody is left on read.

## Billing lifecycle

```mermaid
stateDiagram-v2
  [*] --> Checkout: visitor clicks "Subscribe"
  Checkout --> Invited: Mercado Pago webhook "authorized"
  Invited --> Active: owner creates account from single-use invite
  Active --> Grace: payment failed or cancelled
  Grace --> Active: payment regularized
  Grace --> Suspended: grace period over (login and bot stop, data kept)
  Suspended --> Active: payment regularized
```

## Tenant isolation

```mermaid
flowchart TD
  R[Request to /admin/api/*] --> S{Signed session valid?<br/>user active, token version ok}
  S -- no --> U[401]
  S -- yes --> B[business_id from session only]
  B --> Q[Every SQL filtered by business_id]
  Q --> N{Row found?}
  N -- no --> F[404, same answer for<br/>'missing' and 'not yours']
  N -- yes --> OK[200]
```

## Scheduled jobs

| Job | What it does |
|---|---|
| Appointment reminder | Sends a WhatsApp template before each booking |
| Stuck order alert | Warns the owner about orders pending for too long |
| Post-delivery follow-up | Asks the customer for a rating |
| Daily summary | Sends the owner the day's numbers |
| Retention (LGPD) | Purges conversation history older than the retention window |
| Subscription guard | Moves tenants between active, grace and suspended |
