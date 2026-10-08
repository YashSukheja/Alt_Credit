-- AltCredit schema. Drops and recreates everything (development only).
DROP TABLE IF EXISTS audit_log, import_runs, offers, credit_scores, products,
  transactions, user_features, accounts, users CASCADE;

CREATE TABLE users (
  user_id            VARCHAR(20) PRIMARY KEY,
  applicant_id       UUID UNIQUE NOT NULL,
  age                INT CHECK (age BETWEEN 18 AND 100),
  education_level    VARCHAR(30),
  employment_status  VARCHAR(30),
  monthly_income     NUMERIC(12,2) NOT NULL CHECK (monthly_income >= 0),
  city_tier          INT CHECK (city_tier IN (1, 2, 3)),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  account_id     SERIAL PRIMARY KEY,
  username       VARCHAR(50) UNIQUE NOT NULL,
  password_hash  TEXT NOT NULL,
  role           VARCHAR(10) NOT NULL CHECK (role IN ('user', 'lender', 'admin')),
  user_id        VARCHAR(20) REFERENCES users(user_id),
  lender_name    VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (role <> 'user' OR user_id IS NOT NULL)
);

CREATE TABLE user_features (
  user_id               VARCHAR(20) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  months_at_job         INT CHECK (months_at_job >= 0),
  housing               VARCHAR(10) CHECK (housing IN ('owner', 'rent', 'none')),
  rent_on_time_months   INT CHECK (rent_on_time_months >= 0),
  digital_payment_rate  NUMERIC(4,3) CHECK (digital_payment_rate BETWEEN 0 AND 1),
  education             VARCHAR(20),
  monthly_spend         NUMERIC(12,2) CHECK (monthly_spend >= 0),
  essential_pct         NUMERIC(4,3) CHECK (essential_pct BETWEEN 0 AND 1),
  cashflow_volatility   NUMERIC(4,3) CHECK (cashflow_volatility >= 0),
  savings_days          INT CHECK (savings_days >= 0),
  on_time_rate          NUMERIC(4,3) CHECK (on_time_rate BETWEEN 0 AND 1),
  dti                   NUMERIC(4,3) CHECK (dti >= 0),
  credit_util           NUMERIC(4,3) CHECK (credit_util >= 0),
  delinq_30plus         INT NOT NULL DEFAULT 0,
  delinq_60plus         INT NOT NULL DEFAULT 0,
  delinq_90plus         INT NOT NULL DEFAULT 0,
  positive_habits       INT NOT NULL DEFAULT 0,
  risk_flags            INT NOT NULL DEFAULT 0,
  source                VARCHAR(10) NOT NULL DEFAULT 'dataset' CHECK (source IN ('dataset', 'upload')),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  transaction_id  VARCHAR(30) PRIMARY KEY,
  user_id         VARCHAR(20) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  txn_date        DATE NOT NULL,
  amount          NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category        VARCHAR(30) NOT NULL,
  type            VARCHAR(6) NOT NULL CHECK (type IN ('DEBIT', 'CREDIT')),
  status          VARCHAR(10) NOT NULL CHECK (status IN ('Completed', 'Late'))
);
CREATE INDEX idx_transactions_user_date ON transactions (user_id, txn_date);

CREATE TABLE products (
  product_id     VARCHAR(10) PRIMARY KEY,
  product_name   VARCHAR(100) NOT NULL,
  type           VARCHAR(20) NOT NULL,
  min_score      INT NOT NULL CHECK (min_score BETWEEN 0 AND 1000),
  interest_rate  NUMERIC(5,2),
  rate_unit      VARCHAR(5)
);

CREATE TABLE credit_scores (
  score_id      SERIAL PRIMARY KEY,
  user_id       VARCHAR(20) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  score         INT NOT NULL CHECK (score BETWEEN 0 AND 1000),
  raw_points    INT NOT NULL,
  risk_band     VARCHAR(20) NOT NULL,
  breakdown     JSONB NOT NULL,
  rule_version  VARCHAR(10) NOT NULL DEFAULT 'v1',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scores_user_latest ON credit_scores (user_id, created_at DESC);

CREATE TABLE offers (
  offer_id      SERIAL PRIMARY KEY,
  user_id       VARCHAR(20) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  product_id    VARCHAR(10) NOT NULL REFERENCES products(product_id),
  lender_id     INT NOT NULL REFERENCES accounts(account_id),
  status        VARCHAR(10) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked')),
  bank_reference VARCHAR(50),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at  TIMESTAMPTZ,
  UNIQUE (user_id, product_id, lender_id)
);

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor       VARCHAR(50) NOT NULL,
  action      VARCHAR(50) NOT NULL,
  entity      VARCHAR(30),
  entity_id   VARCHAR(50),
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

CREATE TABLE import_runs (
  id          SERIAL PRIMARY KEY,
  file_name   VARCHAR(200) NOT NULL,
  total       INT NOT NULL,
  accepted    INT NOT NULL,
  rejected    INT NOT NULL,
  errors      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);