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
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type HostHandler struct {
	db *pgxpool.Pool
}

func NewHostHandler(pool *pgxpool.Pool) *HostHandler {
	return &HostHandler{db: pool}
}

// ─── Requête JSON ─────────────────────────────────────────────────────────────
// Les bytes (encrypted_cred, iv) sont transportés en base64 dans le JSON.

type hostRequest struct {
	Name          string   `json:"name"`
	Hostname      string   `json:"hostname"`
	Port          int      `json:"port"`
	Username      string   `json:"username"`
	AuthType      string   `json:"auth_type"`
	EncryptedCred string   `json:"encrypted_cred"` // base64
	IV            string   `json:"iv"`             // base64
	Tags          []string `json:"tags"`
	Icon          string   `json:"icon"`
}

func (h *hostRequest) toModel() (*models.CreateHostInput, error) {
	encCred, err := base64.StdEncoding.DecodeString(h.EncryptedCred)
	if err != nil {
		return nil, errors.New("invalid encrypted_cred encoding")
	}
	iv, err := base64.StdEncoding.DecodeString(h.IV)
	if err != nil {
		return nil, errors.New("invalid iv encoding")
	}
	if len(iv) != 12 {
		return nil, errors.New("iv must be 12 bytes (96 bits)")
	}
	port := h.Port
	if port == 0 {
		port = 22
	}
	tags := h.Tags
	if tags == nil {
		tags = []string{}
	}
	return &models.CreateHostInput{
		Name:          h.Name,
		Hostname:      h.Hostname,
		Port:          port,
		Username:      h.Username,
		AuthType:      h.AuthType,
		EncryptedCred: encCred,
		IV:            iv,
		Tags:          tags,
		Icon:          h.Icon,
	}, nil
}

func validateHostRequest(h *hostRequest) string {
	if h.Name == "" {
		return "name is required"
	}
	if h.Hostname == "" {
		return "hostname is required"
	}
	if h.Username == "" {
		return "username is required"
	}
	if h.AuthType != "password" && h.AuthType != "key" {
		return "auth_type must be 'password' or 'key'"
	}
	if h.EncryptedCred == "" {
		return "encrypted_cred is required"
	}
	if h.IV == "" {
		return "iv is required"
	}
	return ""
}

// ─── Réponse JSON ─────────────────────────────────────────────────────────────

type hostResponse struct {
	ID            string   `json:"id"`
	UserID        string   `json:"user_id"`
	Name          string   `json:"name"`
	Hostname      string   `json:"hostname"`
	Port          int      `json:"port"`
	Username      string   `json:"username"`
	AuthType      string   `json:"auth_type"`
	EncryptedCred string   `json:"encrypted_cred"` // base64
	IV            string   `json:"iv"`             // base64
	Tags          []string `json:"tags"`
	Icon          string   `json:"icon"`
	CreatedAt     string   `json:"created_at"`
	UpdatedAt     string   `json:"updated_at"`
}

func toHostResponse(h *models.Host) hostResponse {
	tags := h.Tags
	if tags == nil {
		tags = []string{}
	}
	return hostResponse{
		ID:            h.ID,
		UserID:        h.UserID,
		Name:          h.Name,
		Hostname:      h.Hostname,
		Port:          h.Port,
		Username:      h.Username,
		AuthType:      h.AuthType,
		EncryptedCred: base64.StdEncoding.EncodeToString(h.EncryptedCred),
		IV:            base64.StdEncoding.EncodeToString(h.IV),
		Tags:          tags,
		Icon:          h.Icon,
		CreatedAt:     h.CreatedAt.String(),
		UpdatedAt:     h.UpdatedAt.String(),
	}
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

func (h *HostHandler) List(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	hosts, err := db.ListHostsByUser(r.Context(), h.db, user.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	resp := make([]hostResponse, 0, len(hosts))
	for _, host := range hosts {
		resp = append(resp, toHostResponse(host))
	}
	jsonResponse(w, resp, http.StatusOK)
}

func (h *HostHandler) Create(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	var req hostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if msg := validateHostRequest(&req); msg != "" {
		jsonError(w, msg, http.StatusBadRequest)
		return
	}
	input, err := req.toModel()
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	host, err := db.CreateHost(r.Context(), h.db, input, user.UserID)
	if err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toHostResponse(host), http.StatusCreated)
}

func (h *HostHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	id := chi.URLParam(r, "id")
	host, err := db.GetHostByID(r.Context(), h.db, id, user.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, "host not found", http.StatusNotFound)
			return
		}
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toHostResponse(host), http.StatusOK)
}

func (h *HostHandler) Update(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	id := chi.URLParam(r, "id")
	var req hostRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		jsonError(w, "invalid request body", http.StatusBadRequest)
		return
	}
	if msg := validateHostRequest(&req); msg != "" {
		jsonError(w, msg, http.StatusBadRequest)
		return
	}
	input, err := req.toModel()
	if err != nil {
		jsonError(w, err.Error(), http.StatusBadRequest)
		return
	}
	host, err := db.UpdateHost(r.Context(), h.db, id, user.UserID, input)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			jsonError(w, "host not found", http.StatusNotFound)
			return
		}
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	jsonResponse(w, toHostResponse(host), http.StatusOK)
}

func (h *HostHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	id := chi.URLParam(r, "id")
	if err := db.DeleteHost(r.Context(), h.db, id, user.UserID); err != nil {
		jsonError(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
