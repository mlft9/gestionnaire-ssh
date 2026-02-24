package handlers

import (
	"net/http"

	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type AdminHandler struct {
	db *pgxpool.Pool
}

func NewAdminHandler(pool *pgxpool.Pool) *AdminHandler {
	return &AdminHandler{db: pool}
}

// GET /api/admin/users
func (h *AdminHandler) ListUsers(w http.ResponseWriter, r *http.Request) {
	users, err := db.ListUsers(r.Context(), h.db)
	if err != nil {
		jsonInternalError(w, "list users", err)
		return
	}

	type userResponse struct {
		ID          string `json:"id"`
		Email       string `json:"email"`
		IsAdmin     bool   `json:"is_admin"`
		TOTPEnabled bool   `json:"totp_enabled"`
		CreatedAt   string `json:"created_at"`
	}

	result := make([]userResponse, 0, len(users))
	for _, u := range users {
		result = append(result, userResponse{
			ID:          u.ID,
			Email:       u.Email,
			IsAdmin:     u.IsAdmin,
			TOTPEnabled: u.TOTPEnabled,
			CreatedAt:   u.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		})
	}
	jsonResponse(w, result, http.StatusOK)
}

// DELETE /api/admin/users/{id}
func (h *AdminHandler) DeleteUser(w http.ResponseWriter, r *http.Request) {
	caller := mw.GetUser(r)
	targetID := chi.URLParam(r, "id")

	// Pas de suppression de soi-même
	if caller.UserID == targetID {
		jsonError(w, "cannot delete your own account", http.StatusBadRequest)
		return
	}

	// Vérifier si la cible est admin avant de supprimer
	target, err := db.GetUserByID(r.Context(), h.db, targetID)
	if err != nil {
		jsonError(w, "user not found", http.StatusNotFound)
		return
	}

	// Pas de suppression du dernier admin
	if target.IsAdmin {
		count, err := db.CountAdmins(r.Context(), h.db)
		if err != nil {
			jsonInternalError(w, "count admins", err)
			return
		}
		if count <= 1 {
			jsonError(w, "cannot delete the last admin", http.StatusBadRequest)
			return
		}
	}

	if err := db.DeleteUserByID(r.Context(), h.db, targetID); err != nil {
		if err == db.ErrNotFound {
			jsonError(w, "user not found", http.StatusNotFound)
			return
		}
		jsonInternalError(w, "delete user", err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// GET /api/admin/sessions
func (h *AdminHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	sessions, err := db.ListSessionsAll(r.Context(), h.db)
	if err != nil {
		jsonInternalError(w, "list sessions", err)
		return
	}
	if sessions == nil {
		jsonResponse(w, []struct{}{}, http.StatusOK)
		return
	}
	jsonResponse(w, sessions, http.StatusOK)
}
