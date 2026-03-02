package ssh

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"
	"time"
	"unsafe"

	"github.com/gestion-ssh/backend/internal/db"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	gossh "golang.org/x/crypto/ssh"
)

// ConnectPayload est défini dans le package ssh (pas ws) pour briser le cycle ws <-> ssh.
type ConnectPayload struct {
	HostID     string `json:"host_id"`
	Credential string `json:"credential"`
	Cols       uint16 `json:"cols"`
	Rows       uint16 `json:"rows"`
}

// Types WS internes prives, pas besoin d'importer le package ws.
type incomingMsg struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}
type inputPayload struct{ Data string `json:"data"` }
type resizePayload struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// Proxy gere le cycle de vie d'une session SSH via WebSocket.
type Proxy struct {
	pool      *pgxpool.Pool
	wsConn    *websocket.Conn
	writeMu   sync.Mutex
	sessionID string
}

func NewProxy(pool *pgxpool.Pool, wsConn *websocket.Conn) *Proxy {
	return &Proxy{pool: pool, wsConn: wsConn}
}

func (p *Proxy) HandleConnection(ctx context.Context, payload ConnectPayload, userID, clientIP string) {
	host, err := db.GetHostByID(ctx, p.pool, payload.HostID, userID)
	if err != nil {
		p.sendError("host not found")
		return
	}

	sshConfig := &gossh.ClientConfig{
		User:            host.Username,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}

	credential := payload.Credential
	switch host.AuthType {
	case "password":
		sshConfig.Auth = []gossh.AuthMethod{gossh.Password(credential)}
	case "key":
		signer, err := gossh.ParsePrivateKey([]byte(credential))
		if err != nil {
			p.sendError("invalid private key")
			zeroString(&credential)
			return
		}
		sshConfig.Auth = []gossh.AuthMethod{gossh.PublicKeys(signer)}
	}
	defer zeroString(&credential)

	client, err := gossh.Dial("tcp", fmt.Sprintf("%s:%d", host.Hostname, host.Port), sshConfig)
	if err != nil {
		p.sendError(fmt.Sprintf("connection failed: %v", err))
		return
	}
	defer client.Close()

	session, err := client.NewSession()
	if err != nil {
		p.sendError("failed to create SSH session")
		return
	}
	defer session.Close()

	modes := gossh.TerminalModes{gossh.ECHO: 1, gossh.TTY_OP_ISPEED: 14400, gossh.TTY_OP_OSPEED: 14400}
	cols, rows := int(payload.Cols), int(payload.Rows)
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	if err := session.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		p.sendError("failed to request PTY")
		return
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		p.sendError("stdin pipe error")
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		p.sendError("stdout pipe error")
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		p.sendError("stderr pipe error")
		return
	}

	if err := session.Shell(); err != nil {
		p.sendError("failed to start shell")
		return
	}

	sessionID, err := db.CreateSession(ctx, p.pool, userID, host.ID, clientIP)
	if err != nil {
		log.Printf("failed to create session record: %v", err)
	}
	p.sessionID = sessionID
	shortID := sessionID
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	tag := fmt.Sprintf("[session=%s host=%s]", shortID, host.Name)
	log.Printf("%s session started (user=%s ip=%s)", tag, userID, clientIP)
	p.send("connected", map[string]string{"session_id": sessionID, "host_name": host.Name})

	ctx2, cancel := context.WithCancel(ctx)
	defer cancel()

	// WebSocket keepalive : envoie un ping toutes les 30s pour maintenir la connexion
	// à travers les NAT/firewalls qui coupent les TCP idle.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx2.Done():
				log.Printf("%s ws-keepalive goroutine: ctx done, exiting", tag)
				return
			case <-ticker.C:
				p.writeMu.Lock()
				err := p.wsConn.WriteMessage(websocket.PingMessage, nil)
				p.writeMu.Unlock()
				if err != nil {
					log.Printf("%s ws-keepalive: ping failed: %v → cancelling", tag, err)
					cancel()
					return
				}
				log.Printf("%s ws-keepalive: ping OK", tag)
			}
		}
	}()

	// SSH keepalive : envoie un keepalive au serveur SSH toutes les 30s.
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx2.Done():
				log.Printf("%s ssh-keepalive goroutine: ctx done, exiting", tag)
				return
			case <-ticker.C:
				_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
				if err != nil {
					log.Printf("%s ssh-keepalive: request failed: %v → cancelling", tag, err)
					cancel()
					return
				}
				log.Printf("%s ssh-keepalive: OK", tag)
			}
		}
	}()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stdout.Read(buf)
			if n > 0 {
				p.send("output", map[string]string{"data": string(buf[:n])})
			}
			if err != nil {
				log.Printf("%s stdout goroutine: read error: %v → closing ws", tag, err)
				p.send("closed", map[string]string{"reason": "ssh closed"})
				p.wsConn.Close()
				cancel()
				return
			}
		}
	}()
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := stderr.Read(buf)
			if n > 0 {
				p.send("output", map[string]string{"data": string(buf[:n])})
			}
			if err != nil {
				log.Printf("%s stderr goroutine: read error: %v", tag, err)
				return
			}
		}
	}()

	for {
		select {
		case <-ctx2.Done():
			log.Printf("%s main loop: ctx done, exiting", tag)
			return
		default:
		}

		_, raw, err := p.wsConn.ReadMessage()
		if err != nil {
			log.Printf("%s main loop: ws ReadMessage error: %v", tag, err)
			return
		}

		var msg incomingMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "input":
			var in inputPayload
			if err := json.Unmarshal(msg.Payload, &in); err != nil {
				continue
			}
			io.WriteString(stdin, in.Data)
		case "resize":
			var r resizePayload
			if err := json.Unmarshal(msg.Payload, &r); err != nil {
				continue
			}
			session.WindowChange(int(r.Rows), int(r.Cols))
		case "disconnect":
			log.Printf("%s client sent disconnect", tag)
			return
		}
	}
}

func (p *Proxy) send(msgType string, payload interface{}) {
	type outMsg struct {
		Type    string      `json:"type"`
		Payload interface{} `json:"payload"`
	}
	data, err := json.Marshal(outMsg{Type: msgType, Payload: payload})
	if err != nil {
		return
	}
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	p.wsConn.WriteMessage(websocket.TextMessage, data)
}

func (p *Proxy) sendError(message string) {
	p.send("error", map[string]string{"message": message})
}

func (p *Proxy) CloseSession(ctx context.Context) {
	if p.sessionID != "" {
		db.CloseSession(ctx, p.pool, p.sessionID)
	}
}

func zeroString(s *string) {
	if len(*s) == 0 {
		return
	}
	b := []byte(strings.Repeat("\x00", len(*s)))
	sp := (*[2]uintptr)(unsafe.Pointer(s))
	dp := (*[2]uintptr)(unsafe.Pointer(&b))
	sp[0] = dp[0]
	*s = string(b)
}
