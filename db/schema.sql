-- StarryTales database schema
-- Run with: psql "$DATABASE_URL" -f db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id                  SERIAL PRIMARY KEY,
  parent_email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash       VARCHAR(255) NOT NULL,
  timezone            VARCHAR(64) NOT NULL DEFAULT 'America/New_York', -- IANA tz name
  stripe_customer_id  VARCHAR(255) UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS children (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  story_theme   VARCHAR(50) NOT NULL, -- adventure | fantasy | space | underwater | animals | fairytale
  active        BOOLEAN NOT NULL DEFAULT true, -- lets a parent pause one child's delivery
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id                       SERIAL PRIMARY KEY,
  user_id                  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_subscription_id   VARCHAR(255) UNIQUE,
  status                   VARCHAR(50) NOT NULL DEFAULT 'incomplete', -- mirrors Stripe subscription.status
  current_period_end       TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stories (
  id                SERIAL PRIMARY KEY,
  child_id          INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  title             VARCHAR(255) NOT NULL,
  body              TEXT NOT NULL,
  delivery_status   VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending | sent | failed
  sent_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_children_user_id ON children(user_id);
CREATE INDEX IF NOT EXISTS idx_stories_child_id ON stories(child_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions(stripe_subscription_id);
