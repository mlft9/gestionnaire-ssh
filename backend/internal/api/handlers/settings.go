package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gestion-ssh/backend/internal/config"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SettingsHandler struct {
	db  *pgxpool.Pool
	cfg *config.Config
}

func NewSettingsHandler(pool *pgxpool.Pool, cfg *config.Config) *SettingsHandler {
	return &SettingsHandler{db: pool, cfg: cfg}
}

// GET /api/settings/totp-required — public
func (h *SettingsHandler) GetTOTPRequired(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, map[string]bool{"totp_required": h.cfg.TOTPRequired}, http.StatusOK)
}

// GET /api/settings/registration — public
func (h *SettingsHandler) GetRegistration(w http.ResponseWriter, r *http.Request) {
	val, err := db.GetSetting(r.Context(), h.db, "allow_registration")
	if err != nil {
		// Default to true if setting not found
		jsonResponse(w, map[string]bool{"allow_registration": true}, http.StatusOK)
		return
	}
	jsonResponse(w, map[string]bool{"allow_registration": val == "true"}, http.StatusOK)
}

// PUT /api/settings/registration — admin only
func (h *SettingsHandler) SetRegistration(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Allow bool `json:"allow_registration"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}

	val := "false"
	if req.Allow {
		val = "true"
	}
	if err := db.SetSetting(r.Context(), h.db, "allow_registration", val); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]bool{"allow_registration": req.Allow}, http.StatusOK)
}
