package handlers

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"

	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/gestion-ssh/backend/internal/models"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CredentialHandler struct {
	db *pgxpool.Pool
}

func NewCredentialHandler(pool *pgxpool.Pool) *CredentialHandler {
	return &CredentialHandler{db: pool}
}

// ─── Requête / réponse JSON ───────────────────────────────────────────────────

type credentialRequest struct {
	Name          string `json:"name"`
	Type          string `json:"type"`           // "key" | "password"
	EncryptedCred string `json:"encrypted_cred"` // base64
	IV            string `json:"iv"`             // base64
}

type credentialResponse struct {
	ID            string `json:"id"`
	UserID        string `json:"user_id"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	EncryptedCred string `json:"encrypted_cred"` // base64
	IV            string `json:"iv"`             // base64
	CreatedAt     string `json:"created_at"`
}

func toCredentialResponse(c *models.Credential) credentialResponse {
	return credentialResponse{
		ID:            c.ID,
		UserID:        c.UserID,
		Name:          c.Name,
		Type:          c.Type,
		EncryptedCred: base64.StdEncoding.EncodeToString(c.EncryptedCred),
		IV:            base64.StdEncoding.EncodeToString(c.IV),
		CreatedAt:     c.CreatedAt.String(),
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func (h *CredentialHandler) List(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	creds, err := db.ListCredentialsByUser(r.Context(), h.db, user.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	resp := make([]credentialResponse, 0, len(creds))
	for _, c := range creds {
		resp = append(resp, toCredentialResponse(c))
	}
	jsonResponse(w, resp, http.StatusOK)
}

func (h *CredentialHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	var req credentialRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if req.Name == "" {
		jsonError(w, "name is required", http.StatusBadRequest)
		return
	}
	if req.Type != "key" && req.Type != "password" {
		jsonError(w, "type must be 'key' or 'password'", http.StatusBadRequest)
		return
	}
	encCred, err := base64.StdEncoding.DecodeString(req.EncryptedCred)
	if err != nil {
		jsonError(w, "invalid encrypted_cred encoding", http.StatusBadRequest)
		return
	}
	iv, err := base64.StdEncoding.DecodeString(req.IV)
	if err != nil || len(iv) != 12 {
		jsonError(w, "invalid iv (must be 12 bytes)", http.StatusBadRequest)
		return
	}

	input := &models.CreateCredentialInput{
		Name:          req.Name,
		Type:          req.Type,
		EncryptedCred: encCred,
		IV:            iv,
	}
	cred, err := db.CreateCredential(r.Context(), h.db, input, user.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toCredentialResponse(cred), http.StatusCreated)
}

func (h *CredentialHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	id := chi.URLParam(r, "id")
	if err := db.DeleteCredential(r.Context(), h.db, id, user.UserID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			jsonError(w, "credential not found", http.StatusNotFound)
			return
		}
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
