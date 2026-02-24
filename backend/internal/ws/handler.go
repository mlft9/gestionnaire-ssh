package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	sshproxy "github.com/gestion-ssh/backend/internal/ssh"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	pool     *pgxpool.Pool
	upgrader websocket.Upgrader
}

func NewHandler(pool *pgxpool.Pool, allowedOrigins []string) *Handler {
	h := &Handler{pool: pool}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  4096,
		WriteBufferSize: 4096,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
				// Requête same-origin (pas de header Origin)
				return true
			}
			for _, allowed := range allowedOrigins {
				if origin == strings.TrimSpace(allowed) {
					return true
				}
			}
			return false
		},
	}
	return h
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	// Premier message attendu : "connect"
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var msg ClientMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		sendWSError(conn, "invalid message format")
		return
	}

	if msg.Type != MsgConnect {
		sendWSError(conn, "expected connect message")
		return
	}

	var payload sshproxy.ConnectPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		sendWSError(conn, "invalid connect payload")
		return
	}

	if payload.HostID == "" || payload.Credential == "" {
		sendWSError(conn, "host_id and credential are required")
		return
	}

	// Utiliser X-Real-IP (positionné par nginx) plutôt que X-Forwarded-For (falsifiable)
	clientIP := r.RemoteAddr
	if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
		clientIP = realIP
	}

	proxy := sshproxy.NewProxy(h.pool, conn)
	defer proxy.CloseSession(r.Context())
	proxy.HandleConnection(r.Context(), payload, user.UserID, clientIP)
}

func sendWSError(conn *websocket.Conn, message string) {
	type errMsg struct {
		Type    string            `json:"type"`
		Payload map[string]string `json:"payload"`
	}
	data, _ := json.Marshal(errMsg{Type: "error", Payload: map[string]string{"message": message}})
	conn.WriteMessage(websocket.TextMessage, data)
}
