# AltCredit: Alternative Credit Scoring API

Scores first-time borrowers (students, gig workers, young professionals) on everyday behaviour
instead of loan history: rent and bills paid on time, savings, spending habits, job stability.
Every score comes with a reason for each factor and tips to improve it.

## Quick start

Requirements: Node 18+, PostgreSQL 14+.

```bash
# 1. Databases (in psql)
CREATE DATABASE altcredit;
CREATE DATABASE altcredit_test;   # only for integration tests

# 2. Install
npm install
cd bank-mock && npm install && cd ..

# 3. Config
cp .env.example .env               # set your Postgres password, JWT_SECRET, BANK_API_KEY
cp bank-mock/.env.example bank-mock/.env   # BANK_API_KEY must match the server's

# 4. Build everything: tables -> import data -> demo logins -> score all users (~5 s)
npm run setup

# 5. Run (two terminals)
cd bank-mock && npm run dev       # mock partner bank on :5001
npm run dev                       # AltCredit API on :5000
```

Check: `curl localhost:5000/health` returns `{"status":"ok","database":"up",...}`.

### Demo logins

Passwords come from `.env` (`SEED_*_PASSWORD`).

| Role | Username | Can do |
|---|---|---|
| user | `usr001` … `usr500` | own score, transactions, what-if, offers, PDF report |
| lender | `lender1` (FinFirst Bank), `lender2` (MicroCred Finance) | search anonymised candidates, send offers |
| admin | `admin` | import, score all, audit log, view any user |

## Architecture

```
React (Vite, :5173)
      │  JWT in "Authorization: Bearer ..."
      ▼
AltCredit API (Express, :5000)
  routes/      thin: read request → call service → send JSON
  middleware/  requestLogger → requireAuth → requireRole → ownership check → errorHandler
  services/    DB queries + business rules + audit log
  engine/      pure scoring (no DB, no HTTP): rules.js (data) + scorer.js
  reports/     PDF drawing only
  clients/     bank client: timeout + retry + Idempotency-Key
      │                                   │  x-api-key
      ▼                                   ▼
PostgreSQL                         Mock bank (separate app, :5001)
                                   own rules, own storage
```

### Data flow

`dataset files → validate rows → upsert in one transaction → score (engine) → store history → API → UI / PDF`

### Database

| Table | Purpose |
|---|---|
| `users` | demographics (from `demographic_data.json`) |
| `user_features` | scoring inputs (from `new_age_sample_data.json`, joined on `applicant_id`) |
| `transactions` | bank statement lines (from `transactional_data.csv`) |
| `products` | product catalogue with `min_score` |
| `credit_scores` | score history with full breakdown (JSONB); a row is added only when the score changes |
| `accounts` | logins (bcrypt hashes), role, link to `user_id` |
| `offers` | lender → user offers; `UNIQUE(user_id, product_id, lender_id)` |
| `audit_log` | who did what, when |
| `import_runs` | accepted/rejected counts and reasons for every import |

## Scoring

Rule-based, from the problem statement's points table (`src/engine/rules.js`):

| Component | Factors | Max |
|---|---|---|
| Lifestyle | employment stability, housing, digital bill payments, education | 350 |
| Spending | spend-to-income, essential vs discretionary, cash-flow volatility, savings buffer | 350 |
| Repayment | on-time payments, debt-to-income, credit utilisation, missed payments | 570 |
| Adjustments | positive habits (+20 each, max +50), risk flags (−20 each, max −50) | ±50 |

| Score | Band | Unlocks |
|---|---|---|
| 750–1000 | Very Low Risk | Premium Personal Loan |
| 650–749 | Low Risk | Standard Credit Card |
| 550–649 | Medium Risk | Micro-Loan Lite |
| 350–549 | High Risk | Starter Credit Card |
| 0–349 | Very High Risk | none, improvement tips only |

### Assumptions

- **The score is capped at 1000.** The rule table adds up to 1320 raw points. Scaling would leave only 1 of 500 users eligible for the premium loan; capping keeps a realistic spread (495 / 379 / 244 / 108 users qualify for P_01–P_04).
- **Missing data scores 0 and is flagged.** It never crashes and never earns points; for example, no delinquency data does not count as "no missed payments".
- **Features come from `new_age_sample_data.json`.** The transactions cover only 3 months (too short for 12-month on-time rates or 6-month volatility), so they are used for the timeline and evidence, not for scoring the existing 500 users.
- **Education comes from the features file.** It disagrees with `demographic_data.json` for 74 users ("High School" vs "none"); the features file matches the rule categories.
- **Decision on the report:** APPROVED if at least one product is unlocked, otherwise NOT APPROVED. This is a prototype, not a legally binding credit decision.

## API

All routes except `/health` and `/auth/login` need `Authorization: Bearer <token>`.
Errors always look like `{ "error": { "code": "...", "message": "...", "details": ... } }`.

| Method | Route | Role | Description |
|---|---|---|---|
| GET | `/health` | any | API + database status |
| POST | `/auth/login` | any | `{username, password}` → `{token, account}` |
| GET | `/auth/me` | logged in | who the token belongs to |
| GET | `/users/:id/score` | self, admin | score, band, 14-factor breakdown, top factors, eligible/locked products |
| GET | `/users/:id/score/history` | self, admin | score changes over time |
| GET | `/users/:id/products` | self, admin | eligible and locked products (points away) |
| GET | `/users/:id/transactions` | self, admin | `?month=2023-06&category=Rent&type=DEBIT&status=Late&sort=amount_desc&page=1&limit=20` |
| POST | `/users/:id/what-if` | self, admin | `{scenario: "save_extra"\|"autopay"\|"overspend"\|"missed_bills", params}` and/or `{changes: {...}}`; nothing saved |
| GET | `/users/what-if/scenarios` | logged in | list of presets |
| GET | `/users/:id/offers` | self, admin | offers received |
| POST | `/users/:id/offers/:offerId/accept` | self | calls the partner bank; reveals identity to the lender |
| POST | `/users/:id/offers/:offerId/reject` | self | |
| GET | `/users/:id/report.pdf` | self, admin | transparency report (PDF) |
| GET | `/users/:id/profile.json` | self, admin | same data as JSON export |
| GET | `/lender/candidates` | lender | anonymised search: `?minScore&maxScore&band&city_tier&employment&sort&page&limit` |
| GET | `/lender/candidates/:ref` | lender | anonymised breakdown |
| POST | `/lender/offers` | lender | `{product_id, refs: [...]}`; only if score ≥ product minimum |
| GET | `/lender/offers` | lender | `?status=pending`; `user_id` shown only after acceptance |
| POST | `/admin/import` | admin | validate + load dataset |
| GET | `/admin/import-runs` | admin | import history with counts |
| POST | `/admin/score-all` | admin | score all users |
| GET | `/admin/audit` | admin | `?action=OFFER_SENT&actor=lender1&page=1` |

### Mock bank (`bank-mock/`, port 5001)

| Method | Route | Description |
|---|---|---|
| POST | `/bank/applications` | needs `x-api-key` and `Idempotency-Key`; returns APPROVED/DECLINED by the bank's own policy |
| GET | `/bank/applications/:id` | look up an application |
| POST | `/bank/simulate` | `{mode: "normal"\|"down"\|"slow"}` for the resilience demo |

## Reliability and security

| Concern | How |
|---|---|
| Bad input data | every row validated; bad rows rejected with reasons, counted in `import_runs` |
| Re-running imports | upserts (`ON CONFLICT DO UPDATE`), no duplicates |
| Partial writes | imports and multi-step changes run in one DB transaction |
| Passwords | bcrypt hashes; the same error for unknown user and wrong password |
| Access control | JWT + role check + "only your own data" check |
| Lender privacy | HMAC-based candidate refs, income shown as a band, identity only after acceptance |
| Double clicks | reject = one conditional `UPDATE … WHERE status='pending'`; accept = `SELECT … FOR UPDATE` |
| Duplicate offers | `UNIQUE` constraint + `ON CONFLICT DO NOTHING` |
| Bank down or slow | 5 s timeout, 1 retry on 5xx, rollback (offer stays pending), Idempotency-Key prevents double accounts |
| Score dropped since the offer | offer revoked at accept time |
| SQL injection | parameterised queries only (`$1, $2`) |
| Secrets | `.env` only (git-ignored); `.env.example` has placeholders |
| Browser access | CORS limited to `CLIENT_ORIGIN`; helmet security headers |
| Traceability | `audit_log` for logins, scoring, what-if, offers, reports, imports |

## Tests

```bash
npm test                  # 62 unit tests: engine bands and caps, validators, PDF, bank client (no DB needed)
npm run test:coverage     # coverage report
npm run test:integration  # 17 end-to-end API tests on altcredit_test with a real mock bank
npm run validate:csv -- tests/fixtures/bad_transactions.csv   # dry-run validation: 1 accepted, 8 rejected
npm run score:user -- USR_001                                 # print one user's breakdown
```

Integration tests rebuild `TEST_DATABASE_URL` from scratch and refuse to run if it equals `DATABASE_URL`.

## Demo script (5 minutes)

1. `usr001` → `GET /users/USR_001/score`: **635, Medium Risk**, eligible for 2 products, 15 points from the Standard Card
2. Show the breakdown: on-time payments 61% earns 0/200. That one factor explains the score.
3. What-if `autopay`: **635 → 885**, unlocks the Standard Card and the Premium Loan
4. Download `report.pdf`
5. `lender1` → `GET /lender/candidates?minScore=600`: anonymised list, send `P_02` to USR_001
6. `usr001` accepts → bank approves, reference `BNK-…`; the lender now sees who it is
7. Bank `down` → accept fails cleanly, offer stays pending; bank `normal` → retry works
8. `admin` → `GET /admin/audit`: every step above is recorded
