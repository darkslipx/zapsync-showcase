# Engineering decisions

Short records of choices I made and why. Each one came from a real constraint of running a SaaS alone.

## 1. Official WhatsApp Cloud API instead of unofficial libraries
Unofficial WhatsApp Web libraries are cheaper to start with, but numbers get banned and sessions drop. Restaurants depend on WhatsApp for revenue, so reliability and compliance won. The cost is Meta's approval process, message templates and per-conversation pricing, which the product is designed around.

## 2. Same-origin proxy for the panel
The site (Vercel) and the API (Railway) live on different domains. Calling the API cross-origin would require a third-party cookie (`SameSite=None`), which browsers block more every year, especially in private tabs. `vercel.json` rewrites `/admin/api/*` to the API, so the session cookie is first-party with `SameSite=Lax`. The Mercado Pago webhook still goes straight to Railway, since it is server-to-server.

## 3. No ORM and no auth framework
The API uses parameterized SQL through `pg`, `scrypt` from Node's standard library for passwords and an HMAC-signed session. Fewer dependencies means fewer supply-chain risks and fewer upgrades to babysit, and every security-relevant line is code I can read and test. The trade-off is writing more SQL by hand, which the test suite covers.

## 4. Additive migrations on boot
Migrations only add (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`) and run automatically at startup. Deploying is a `git push`; there is never a manual database step or a migration that can break existing data.

## 5. AI cascade instead of a single provider
A single provider failing at dinner time means lost orders. Replies go through an ordered list of providers, accounts and model sizes, and the panel shows how many answers came from each, so I can see degradation before customers notice. OpenAI's structured output is used when available; for fallbacks, JSON is requested by instruction and parsed defensively.

## 6. Double booking blocked in the database
Two customers can ask for the same slot within the same second. Checking availability in application code has a race condition, so a unique index on the appointment slot makes the database the final judge: the second booking for the same slot is rejected no matter how close the requests arrive.

## 7. Suspension without deletion
When a payment fails, the tenant gets a grace period and is then suspended: login and the bot stop, but no data is removed. Customers who pay late come back exactly where they were, which reduces churn and support work.

## 8. Vanilla frontend without a build step
Each page is a self-contained HTML file. For a solo developer this means zero build tooling to maintain, instant deploys and pages that load fast on cheap phones, which is what many restaurant owners use.

## 9. Embeddings without pgvector
Semantic search needed vectors, and the obvious choice was pgvector, which the managed PostgreSQL on Railway does not ship. A single business has at most a few hundred menu items, so vectors are stored in a `REAL[]` column and compared with cosine similarity in Node, which takes well under a millisecond at that size. No new infrastructure, no extension to maintain, and the same code runs on any PostgreSQL. If a tenant ever grows into tens of thousands of items, moving to pgvector is a storage change, not a redesign.

## 10. Deterministic eval scorer instead of LLM-as-judge
Using a model to grade the model is convenient, but then the score drifts with the judge and a regression can hide behind a lenient grade. The bot already returns structured JSON, so the scorer compares fields (event type, item codes and quantities, payment, date) and runs regexes over the text the customer sees. The score is reproducible, and the scorer has its own tests.

## 11. MCP server through the API, not the database
The MCP server could have connected straight to PostgreSQL. Instead it logs in to the panel API as the owner, the same way the browser does. Every tool call goes through the same tenant scoping, validation, rate limits and audit log as the panel, so an assistant can never see or change another business's data, and there is one less place holding database credentials.
