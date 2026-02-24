package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gestion-ssh/backend/internal/auth"
	"github.com/gestion-ssh/backend/internal/config"
	"github.com/gestion-ssh/backend/internal/db"
	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AuthHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewAuthHandler(pool *pgxpool.Pool, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: pool, cfg: cfg}
}

// ─── Register ─────────────────────────────────────────────────────────────────

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Email == "" || len(req.Password) < 8 {
		jsonError(w, "email required and password must be at least 8 characters", http.StatusBadRequest)
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	kdfSalt, err := auth.GenerateKDFSalt()
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Vérifier si les inscriptions sont autorisées
	val, err := db.GetSetting(r.Context(), h.db, "allow_registration")
	if err == nil && val == "false" {
		jsonError(w, "registration is disabled", http.StatusForbidden)
		return
	}

	user, err := db.CreateUser(r.Context(), h.db, req.Email, hash, kdfSalt)
	if err != nil {
		jsonError(w, "email already in use", http.StatusConflict)
		return
	}

	jsonResponse(w, map[string]interface{}{
		"id":         user.ID,
		"email":      user.Email,
		"kdf_salt":   user.KDFSalt,
		"kdf_params": json.RawMessage(user.KDFParams),
	}, http.StatusCreated)
}

// ─── Login ────────────────────────────────────────────────────────────────────

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	user, err := db.GetUserByEmail(r.Context(), h.db, req.Email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, "invalid credentials", http.StatusUnauthorized)
			return
		}
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	match, err := auth.VerifyPassword(req.Password, user.PasswordHash)
	if err != nil || !match {
		jsonError(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	// Si la 2FA est activée, on retourne un token temporaire au lieu des vrais tokens
	if user.TOTPEnabled {
		totpToken, err := auth.GenerateTOTPPendingToken(h.cfg.JWTSecret, user.ID, user.Email, user.IsAdmin)
		if err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{
			"two_factor_required": true,
			"totp_token":          totpToken,
			"user": map[string]interface{}{
				"kdf_salt":   user.KDFSalt,
				"kdf_params": json.RawMessage(user.KDFParams),
			},
		}, http.StatusOK)
		return
	}

	// Si TOTP obligatoire et non encore configuré, forcer le setup
	if h.cfg.TOTPRequired && !user.TOTPEnabled {
		totpToken, err := auth.GenerateTOTPPendingToken(h.cfg.JWTSecret, user.ID, user.Email, user.IsAdmin)
		if err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]interface{}{
			"two_factor_required": true,
			"totp_setup_required": true,
			"totp_token":          totpToken,
			"user": map[string]interface{}{
				"kdf_salt":   user.KDFSalt,
				"kdf_params": json.RawMessage(user.KDFParams),
			},
		}, http.StatusOK)
		return
	}

	accessToken, err := auth.GenerateAccessToken(h.cfg.JWTSecret, user.ID, user.Email, user.IsAdmin)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	refreshToken, err := auth.GenerateRefreshToken(h.cfg.JWTSecret, user.ID, user.Email, user.IsAdmin)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	// Secure=true uniquement sur HTTPS (TLS direct ou derrière un reverse-proxy HTTPS)
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
			"id":           user.ID,
			"email":        user.Email,
			"kdf_salt":     user.KDFSalt,
			"kdf_params":   json.RawMessage(user.KDFParams),
			"is_admin":     user.IsAdmin,
			"totp_enabled": user.TOTPEnabled,
		},
		"access_token": accessToken,
	}, http.StatusOK)
}

// ─── Refresh ──────────────────────────────────────────────────────────────────

func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie("refresh_token")
	if err != nil {
		jsonError(w, "refresh token missing", http.StatusUnauthorized)
		return
	}

	claims, err := auth.ValidateToken(h.cfg.JWTSecret, cookie.Value)
	if err != nil {
		jsonError(w, "invalid refresh token", http.StatusUnauthorized)
		return
	}

	accessToken, err := auth.GenerateAccessToken(h.cfg.JWTSecret, claims.UserID, claims.Email, claims.IsAdmin)
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

	jsonResponse(w, map[string]string{"access_token": accessToken}, http.StatusOK)
}

// ─── Logout ───────────────────────────────────────────────────────────────────

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	isSecure := r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https"
	for _, name := range []string{"access_token", "refresh_token"} {
		http.SetCookie(w, &http.Cookie{
			Name:     name,
			Value:    "",
			HttpOnly: true,
			Secure:   isSecure,
			SameSite: http.SameSiteStrictMode,
			Path:     "/",
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
		})
	}
	jsonResponse(w, map[string]string{"message": "logged out"}, http.StatusOK)
}

// ─── UpdateProfile ────────────────────────────────────────────────────────────

type updateProfileRequest struct {
	Action          string `json:"action"` // "email" | "password"
	CurrentPassword string `json:"current_password"`
	NewEmail        string `json:"new_email,omitempty"`
	NewPassword     string `json:"new_password,omitempty"`
}

func (h *AuthHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	userClaims := mw.GetUser(r)

	var req updateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.CurrentPassword == "" {
		jsonError(w, "current_password required", http.StatusBadRequest)
		return
	}

	user, err := db.GetUserByID(r.Context(), h.db, userClaims.UserID)
	if err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}

	match, err := auth.VerifyPassword(req.CurrentPassword, user.PasswordHash)
	if err != nil || !match {
		jsonError(w, "invalid current password", http.StatusUnauthorized)
		return
	}

	switch req.Action {
	case "email":
		if req.NewEmail == "" {
			jsonError(w, "new_email required", http.StatusBadRequest)
			return
		}
		if err := db.UpdateUserEmail(r.Context(), h.db, userClaims.UserID, req.NewEmail); err != nil {
			jsonError(w, "email already in use", http.StatusConflict)
			return
		}
		jsonResponse(w, map[string]string{"message": "email updated", "new_email": req.NewEmail}, http.StatusOK)

	case "password":
		if len(req.NewPassword) < 8 {
			jsonError(w, "new password must be at least 8 characters", http.StatusBadRequest)
			return
		}
		hash, err := auth.HashPassword(req.NewPassword)
		if err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		newKDFSalt, err := auth.GenerateKDFSalt()
		if err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		if err := db.UpdateUserPassword(r.Context(), h.db, userClaims.UserID, hash, newKDFSalt); err != nil {
			jsonError(w, "internal error", http.StatusInternalServerError)
			return
		}
		jsonResponse(w, map[string]string{"message": "password updated"}, http.StatusOK)

	default:
		jsonError(w, "invalid action", http.StatusBadRequest)
	}
}

// ─── Me ───────────────────────────────────────────────────────────────────────

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	u, err := db.GetUserByID(r.Context(), h.db, user.UserID)
	if err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}
	jsonResponse(w, map[string]interface{}{
		"id":           u.ID,
		"email":        u.Email,
		"kdf_salt":     u.KDFSalt,
		"kdf_params":   json.RawMessage(u.KDFParams),
		"is_admin":     u.IsAdmin,
		"totp_enabled": u.TOTPEnabled,
	}, http.StatusOK)
}
