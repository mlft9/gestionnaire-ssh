package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gestion-ssh/backend/internal/auth"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

type InitHandler struct {
	db *pgxpool.Pool
}

func NewInitHandler(pool *pgxpool.Pool) *InitHandler {
	return &InitHandler{db: pool}
}

// GET /api/init/status — indique si l'application a déjà été initialisée
func (h *InitHandler) Status(w http.ResponseWriter, r *http.Request) {
	count, err := db.CountUsers(r.Context(), h.db)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, map[string]bool{"initialized": count > 0}, http.StatusOK)
}

// POST /api/init — crée le premier compte admin (une seule fois)
func (h *InitHandler) Init(w http.ResponseWriter, r *http.Request) {
	// Vérifier que l'app n'est pas déjà initialisée
	count, err := db.CountUsers(r.Context(), h.db)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	if count > 0 {
		jsonError(w, "already initialized", http.StatusConflict)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
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

	_, err = db.CreateAdminUser(r.Context(), h.db, req.Email, hash, kdfSalt)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}

	jsonResponse(w, map[string]string{"message": "initialized"}, http.StatusCreated)
}
