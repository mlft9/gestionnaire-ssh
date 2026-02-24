package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gestion-ssh/backend/internal/auth"
	"github.com/gestion-ssh/backend/internal/config"
	"github.com/gestion-ssh/backend/internal/db"
	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TOTPHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewTOTPHandler(pool *pgxpool.Pool, cfg *config.Config) *TOTPHandler {
	return &TOTPHandler{db: pool, cfg: cfg}
}

// GET /api/auth/2fa/setup — génère un secret TOTP + QR code (auth requise, 2FA non encore activée)
func (h *TOTPHandler) Setup(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)

	_, enabled, err := db.GetTOTPSecret(r.Context(), h.db, user.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	if enabled {
		jsonError(w, "2FA is already enabled", http.StatusConflict)
		return
	}

	u, err := db.GetUserByID(r.Context(), h.db, user.UserID)
	if err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}

	setup, err := auth.GenerateTOTPSecret(u.Email, "SSH Manager")
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	if err := db.SetTOTPSecret(r.Context(), h.db, user.UserID, setup.Secret); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{
		"secret":      setup.Secret,
		"otpauth_url": setup.OTPAuthURL,
	}, http.StatusOK)
}

// POST /api/auth/2fa/enable — vérifie le premier code et active la 2FA
func (h *TOTPHandler) Enable(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		jsonError(w, "code required", http.StatusBadRequest)
		return
	}

	secret, enabled, err := db.GetTOTPSecret(r.Context(), h.db, user.UserID)
	if err != nil || secret == "" {
		jsonError(w, "run setup first", http.StatusBadRequest)
		return
	}
	if enabled {
		jsonError(w, "2FA is already enabled", http.StatusConflict)
		return
	}

	if !auth.ValidateTOTP(req.Code, secret) {
		jsonError(w, "invalid code", http.StatusUnauthorized)
		return
	}

	if err := db.EnableTOTP(r.Context(), h.db, user.UserID); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"message": "2FA enabled"}, http.StatusOK)
}

// POST /api/auth/2fa/disable — vérifie le code et désactive la 2FA
func (h *TOTPHandler) Disable(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Code == "" {
		jsonError(w, "code required", http.StatusBadRequest)
		return
	}

	secret, enabled, err := db.GetTOTPSecret(r.Context(), h.db, user.UserID)
	if err != nil || !enabled || secret == "" {
		jsonError(w, "2FA is not enabled", http.StatusBadRequest)
		return
	}

	if !auth.ValidateTOTP(req.Code, secret) {
		jsonError(w, "invalid code", http.StatusUnauthorized)
		return
	}

	if err := db.DisableTOTP(r.Context(), h.db, user.UserID); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"message": "2FA disabled"}, http.StatusOK)
}

// POST /api/auth/2fa/verify — étape 2 du login : vérifie le code TOTP et émet les vrais tokens
func (h *TOTPHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		TOTPToken string `json:"totp_token"`
		Code      string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.TOTPToken == "" || req.Code == "" {
		jsonError(w, "totp_token and code are required", http.StatusBadRequest)
		return
	}

	claims, err := auth.ValidateToken(h.cfg.JWTSecret, req.TOTPToken)
	if err != nil || claims.TokenType != "totp_pending" {
		jsonError(w, "invalid or expired TOTP token", http.StatusUnauthorized)
		return
	}

	secret, enabled, err := db.GetTOTPSecret(r.Context(), h.db, claims.UserID)
	if err != nil || !enabled || secret == "" {
		jsonError(w, "2FA not configured", http.StatusBadRequest)
		return
	}

	if !auth.ValidateTOTP(req.Code, secret) {
		jsonError(w, "invalid code", http.StatusUnauthorized)
		return
	}

	accessToken, err := auth.GenerateAccessToken(h.cfg.JWTSecret, claims.UserID, claims.Email, claims.IsAdmin)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	refreshToken, err := auth.GenerateRefreshToken(h.cfg.JWTSecret, claims.UserID, claims.Email, claims.IsAdmin)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	u, err := db.GetUserByID(r.Context(), h.db, claims.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	http.SetCookie(w, &http.Cookie{
		Name:     "access_token",
		Value:    accessToken,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode,
		Path:     "/",
		MaxAge:   int(auth.AccessTokenDuration.Seconds()),
	})
	http.SetCookie(w, &http.Cookie{
		Name:     "refresh_token",
		Value:    refreshToken,
		HttpOnly: true,
		Secure:   isSecure,
		SameSite: http.SameSiteStrictMode,
		Path:     "/api/auth/refresh",
		MaxAge:   int(auth.RefreshTokenDuration.Seconds()),
	})

	jsonResponse(w, map[string]interface{}{
		"user": map[string]interface{}{
			"id":           u.ID,
			"email":        u.Email,
			"kdf_salt":     u.KDFSalt,
			"kdf_params":   json.RawMessage(u.KDFParams),
			"is_admin":     u.IsAdmin,
			"totp_enabled": u.TOTPEnabled,
		},
		"access_token": accessToken,
	}, http.StatusOK)
}
