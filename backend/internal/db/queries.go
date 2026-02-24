package db

import (
	"context"
	"errors"
	"time"

	"github.com/gestion-ssh/backend/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound est retourné quand une opération ne trouve pas la ressource ciblée.
var ErrNotFound = errors.New("not found")

// ─── Users ────────────────────────────────────────────────────────────────────

func CreateUser(ctx context.Context, pool *pgxpool.Pool, email, passwordHash string, kdfSalt []byte) (*models.User, error) {
	user := &models.User{}
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, kdf_salt)
		VALUES ($1, $2, $3)
		RETURNING id, email, password_hash, kdf_salt, kdf_params, is_admin, totp_enabled, created_at
	`, email, passwordHash, kdfSalt).Scan(
		&user.ID, &user.Email, &user.PasswordHash,
		&user.KDFSalt, &user.KDFParams, &user.IsAdmin, &user.TOTPEnabled, &user.CreatedAt,
	)
	return user, err
}

func CreateAdminUser(ctx context.Context, pool *pgxpool.Pool, email, passwordHash string, kdfSalt []byte) (*models.User, error) {
	user := &models.User{}
	err := pool.QueryRow(ctx, `
		INSERT INTO users (email, password_hash, kdf_salt, is_admin)
		VALUES ($1, $2, $3, TRUE)
		RETURNING id, email, password_hash, kdf_salt, kdf_params, is_admin, totp_enabled, created_at
	`, email, passwordHash, kdfSalt).Scan(
		&user.ID, &user.Email, &user.PasswordHash,
		&user.KDFSalt, &user.KDFParams, &user.IsAdmin, &user.TOTPEnabled, &user.CreatedAt,
	)
	return user, err
}

func CountUsers(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var count int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count)
	return count, err
}

func GetUserByEmail(ctx context.Context, pool *pgxpool.Pool, email string) (*models.User, error) {
	user := &models.User{}
	err := pool.QueryRow(ctx, `
		SELECT id, email, password_hash, kdf_salt, kdf_params, is_admin, totp_enabled, created_at
		FROM users WHERE email = $1
	`, email).Scan(
		&user.ID, &user.Email, &user.PasswordHash,
		&user.KDFSalt, &user.KDFParams, &user.IsAdmin, &user.TOTPEnabled, &user.CreatedAt,
	)
	return user, err
}

func GetUserByID(ctx context.Context, pool *pgxpool.Pool, id string) (*models.User, error) {
	user := &models.User{}
	err := pool.QueryRow(ctx, `
		SELECT id, email, password_hash, kdf_salt, kdf_params, is_admin, totp_enabled, created_at
		FROM users WHERE id = $1
	`, id).Scan(
		&user.ID, &user.Email, &user.PasswordHash,
		&user.KDFSalt, &user.KDFParams, &user.IsAdmin, &user.TOTPEnabled, &user.CreatedAt,
	)
	return user, err
}

func UpdateUserEmail(ctx context.Context, pool *pgxpool.Pool, userID, newEmail string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET email = $1 WHERE id = $2`, newEmail, userID)
	return err
}

// UpdateUserPassword met à jour le hash et le sel KDF, et supprime tous les hôtes
// (les credentials chiffrés avec l'ancienne clé maître deviennent inutilisables).
func UpdateUserPassword(ctx context.Context, pool *pgxpool.Pool, userID, newPasswordHash string, newKDFSalt []byte) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err = tx.Exec(ctx,
		`UPDATE users SET password_hash = $1, kdf_salt = $2 WHERE id = $3`,
		newPasswordHash, newKDFSalt, userID,
	); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM hosts WHERE user_id = $1`, userID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM credentials WHERE user_id = $1`, userID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func ListUsers(ctx context.Context, pool *pgxpool.Pool) ([]*models.User, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, email, password_hash, kdf_salt, kdf_params, is_admin, totp_enabled, created_at
		FROM users ORDER BY created_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []*models.User
	for rows.Next() {
		u := &models.User{}
		if err := rows.Scan(
			&u.ID, &u.Email, &u.PasswordHash,
			&u.KDFSalt, &u.KDFParams, &u.IsAdmin, &u.TOTPEnabled, &u.CreatedAt,
		); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

func CountAdmins(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	var count int
	err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users WHERE is_admin = TRUE`).Scan(&count)
	return count, err
}

func DeleteUserByID(ctx context.Context, pool *pgxpool.Pool, id string) error {
	tag, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func ListSessionsAll(ctx context.Context, pool *pgxpool.Pool) ([]*models.SessionWithDetails, error) {
	rows, err := pool.Query(ctx, `
		SELECT s.id,
		       COALESCE(u.email, '(supprimé)'),
		       COALESCE(h.name, '(supprimé)'),
		       COALESCE(h.hostname, ''),
		       s.started_at, s.ended_at, s.client_ip
		FROM sessions s
		LEFT JOIN users u ON s.user_id = u.id
		LEFT JOIN hosts h ON s.host_id = h.id
		ORDER BY s.started_at DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []*models.SessionWithDetails
	for rows.Next() {
		s := &models.SessionWithDetails{}
		if err := rows.Scan(
			&s.ID, &s.UserEmail, &s.HostName, &s.HostHostname,
			&s.StartedAt, &s.EndedAt, &s.ClientIP,
		); err != nil {
			return nil, err
		}
		sessions = append(sessions, s)
	}
	return sessions, rows.Err()
}

// ─── TOTP ──────────────────────────────────────────────────────────────────────

func GetTOTPSecret(ctx context.Context, pool *pgxpool.Pool, userID string) (secret string, enabled bool, err error) {
	var s *string
	err = pool.QueryRow(ctx, `SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, userID).Scan(&s, &enabled)
	if err != nil {
		return "", false, err
	}
	if s != nil {
		secret = *s
	}
	return secret, enabled, nil
}

func SetTOTPSecret(ctx context.Context, pool *pgxpool.Pool, userID, secret string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET totp_secret = $1 WHERE id = $2`, secret, userID)
	return err
}

func EnableTOTP(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET totp_enabled = TRUE WHERE id = $1`, userID)
	return err
}

func DisableTOTP(ctx context.Context, pool *pgxpool.Pool, userID string) error {
	_, err := pool.Exec(ctx, `UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1`, userID)
	return err
}

// ─── Settings ─────────────────────────────────────────────────────────────────

func GetSetting(ctx context.Context, pool *pgxpool.Pool, key string) (string, error) {
	var value string
	err := pool.QueryRow(ctx, `SELECT value FROM app_settings WHERE key = $1`, key).Scan(&value)
	return value, err
}

func SetSetting(ctx context.Context, pool *pgxpool.Pool, key, value string) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO app_settings (key, value) VALUES ($1, $2)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
	`, key, value)
	return err
}

// ─── Hosts ────────────────────────────────────────────────────────────────────

func CreateHost(ctx context.Context, pool *pgxpool.Pool, h *models.CreateHostInput, userID string) (*models.Host, error) {
	if h.Tags == nil {
		h.Tags = []string{}
	}
	host := &models.Host{}
	err := pool.QueryRow(ctx, `
		INSERT INTO hosts (user_id, name, hostname, port, username, auth_type, encrypted_cred, iv, tags, icon)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, user_id, name, hostname, port, username, auth_type, encrypted_cred, iv, tags, icon, created_at, updated_at
	`, userID, h.Name, h.Hostname, h.Port, h.Username,
		h.AuthType, h.EncryptedCred, h.IV, h.Tags, h.Icon).Scan(
		&host.ID, &host.UserID, &host.Name, &host.Hostname,
		&host.Port, &host.Username, &host.AuthType,
		&host.EncryptedCred, &host.IV, &host.Tags, &host.Icon,
		&host.CreatedAt, &host.UpdatedAt,
	)
	if host.Tags == nil {
		host.Tags = []string{}
	}
	return host, err
}

func ListHostsByUser(ctx context.Context, pool *pgxpool.Pool, userID string) ([]*models.Host, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, user_id, name, hostname, port, username, auth_type, encrypted_cred, iv, tags, icon, created_at, updated_at
		FROM hosts WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []*models.Host
	for rows.Next() {
		h := &models.Host{}
		if err := rows.Scan(
			&h.ID, &h.UserID, &h.Name, &h.Hostname,
			&h.Port, &h.Username, &h.AuthType,
			&h.EncryptedCred, &h.IV, &h.Tags, &h.Icon,
			&h.CreatedAt, &h.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if h.Tags == nil {
			h.Tags = []string{}
		}
		hosts = append(hosts, h)
	}
	return hosts, rows.Err()
}

func GetHostByID(ctx context.Context, pool *pgxpool.Pool, id, userID string) (*models.Host, error) {
	h := &models.Host{}
	err := pool.QueryRow(ctx, `
		SELECT id, user_id, name, hostname, port, username, auth_type, encrypted_cred, iv, tags, icon, created_at, updated_at
		FROM hosts WHERE id = $1 AND user_id = $2
	`, id, userID).Scan(
		&h.ID, &h.UserID, &h.Name, &h.Hostname,
		&h.Port, &h.Username, &h.AuthType,
		&h.EncryptedCred, &h.IV, &h.Tags, &h.Icon,
		&h.CreatedAt, &h.UpdatedAt,
	)
	if h.Tags == nil {
		h.Tags = []string{}
	}
	return h, err
}

func UpdateHost(ctx context.Context, pool *pgxpool.Pool, id, userID string, h *models.CreateHostInput) (*models.Host, error) {
	if h.Tags == nil {
		h.Tags = []string{}
	}
	host := &models.Host{}
	err := pool.QueryRow(ctx, `
		UPDATE hosts SET name=$1, hostname=$2, port=$3, username=$4,
		auth_type=$5, encrypted_cred=$6, iv=$7, tags=$8, icon=$9
		WHERE id=$10 AND user_id=$11
		RETURNING id, user_id, name, hostname, port, username, auth_type, encrypted_cred, iv, tags, icon, created_at, updated_at
	`, h.Name, h.Hostname, h.Port, h.Username,
		h.AuthType, h.EncryptedCred, h.IV, h.Tags, h.Icon, id, userID).Scan(
		&host.ID, &host.UserID, &host.Name, &host.Hostname,
		&host.Port, &host.Username, &host.AuthType,
		&host.EncryptedCred, &host.IV, &host.Tags, &host.Icon,
		&host.CreatedAt, &host.UpdatedAt,
	)
	if host.Tags == nil {
		host.Tags = []string{}
	}
	return host, err
}

func DeleteHost(ctx context.Context, pool *pgxpool.Pool, id, userID string) error {
	_, err := pool.Exec(ctx, `DELETE FROM hosts WHERE id = $1 AND user_id = $2`, id, userID)
	return err
}

// ─── Credentials ──────────────────────────────────────────────────────────────

func CreateCredential(ctx context.Context, pool *pgxpool.Pool, c *models.CreateCredentialInput, userID string) (*models.Credential, error) {
	cred := &models.Credential{}
	err := pool.QueryRow(ctx, `
		INSERT INTO credentials (user_id, name, type, encrypted_cred, iv)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, user_id, name, type, encrypted_cred, iv, created_at
	`, userID, c.Name, c.Type, c.EncryptedCred, c.IV).Scan(
		&cred.ID, &cred.UserID, &cred.Name, &cred.Type,
		&cred.EncryptedCred, &cred.IV, &cred.CreatedAt,
	)
	return cred, err
}

func ListCredentialsByUser(ctx context.Context, pool *pgxpool.Pool, userID string) ([]*models.Credential, error) {
	rows, err := pool.Query(ctx, `
		SELECT id, user_id, name, type, encrypted_cred, iv, created_at
		FROM credentials WHERE user_id = $1 ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var creds []*models.Credential
	for rows.Next() {
		c := &models.Credential{}
		if err := rows.Scan(
			&c.ID, &c.UserID, &c.Name, &c.Type,
			&c.EncryptedCred, &c.IV, &c.CreatedAt,
		); err != nil {
			return nil, err
		}
		creds = append(creds, c)
	}
	return creds, rows.Err()
}

func DeleteCredential(ctx context.Context, pool *pgxpool.Pool, id, userID string) error {
	tag, err := pool.Exec(ctx, `DELETE FROM credentials WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

func CreateSession(ctx context.Context, pool *pgxpool.Pool, userID, hostID, clientIP string) (string, error) {
	var sessionID string
	err := pool.QueryRow(ctx, `
		INSERT INTO sessions (user_id, host_id, client_ip)
		VALUES ($1, $2, $3)
		RETURNING id
	`, userID, hostID, clientIP).Scan(&sessionID)
	return sessionID, err
}

func CloseSession(ctx context.Context, pool *pgxpool.Pool, sessionID string) error {
	_, err := pool.Exec(ctx, `
		UPDATE sessions SET ended_at = $1 WHERE id = $2
	`, time.Now(), sessionID)
	return err
}
