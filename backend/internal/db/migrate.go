package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

const schema = `
CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    kdf_salt      BYTEA NOT NULL,
    kdf_params    JSONB NOT NULL DEFAULT '{"m":65536,"t":3,"p":4}',
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrations idempotentes
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Valeur par defaut : inscriptions desactivees (activees par l'admin si besoin)
INSERT INTO app_settings (key, value)
VALUES ('allow_registration', 'false')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS hosts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    hostname         TEXT NOT NULL,
    port             INTEGER NOT NULL DEFAULT 22,
    username         TEXT NOT NULL,
    auth_type        TEXT NOT NULL CHECK (auth_type IN ('password','key')),
    encrypted_cred   BYTEA NOT NULL,
    iv               BYTEA NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migrations idempotentes pour les hôtes
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE hosts ADD COLUMN IF NOT EXISTS icon TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS credentials (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('key','password')),
    encrypted_cred BYTEA NOT NULL,
    iv             BYTEA NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    host_id    UUID NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at   TIMESTAMPTZ,
    client_ip  TEXT
);

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'set_hosts_updated_at'
    ) THEN
        CREATE TRIGGER set_hosts_updated_at
        BEFORE UPDATE ON hosts
        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
    END IF;
END;
$$;
`

func Migrate(pool *pgxpool.Pool) error {
	_, err := pool.Exec(context.Background(), schema)
	return err
}
