package sftp

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	pkgsftp "github.com/pkg/sftp"
	gossh "golang.org/x/crypto/ssh"
)

// ── Types de messages ────────────────────────────────────────────────────────

const (
	// Client → Serveur
	msgConnect = "connect"
	msgLS      = "ls"
	msgGet     = "get"
	msgPut     = "put"
	msgRM      = "rm"
	msgMkdir   = "mkdir"
	msgRename  = "rename"

	// Serveur → Client
	msgConnected = "connected"
	msgLSResult  = "ls_result"
	msgGetResult = "get_result"
	msgDone      = "done"
	msgError     = "error"
)

type clientMsg struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type connectPayload struct {
	HostID     string `json:"host_id"`
	Credential string `json:"credential"`
}

type lsPayload struct {
	Path string `json:"path"`
}

type getPayload struct {
	Path string `json:"path"`
}

type putPayload struct {
	Path string `json:"path"`
	Data string `json:"data"` // base64
}

type rmPayload struct {
	Path string `json:"path"`
}

type mkdirPayload struct {
	Path string `json:"path"`
}

type renamePayload struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// FileEntry est une entrée du répertoire envoyée au client.
type FileEntry struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"is_dir"`
	Mode    string `json:"mode"`
	ModTime string `json:"mod_time"`
}

// ── Handler WebSocket ────────────────────────────────────────────────────────

type Handler struct {
	pool     *pgxpool.Pool
	upgrader websocket.Upgrader
}

func NewHandler(pool *pgxpool.Pool, allowedOrigins []string) *Handler {
	h := &Handler{pool: pool}
	h.upgrader = websocket.Upgrader{
		ReadBufferSize:  32 * 1024,
		WriteBufferSize: 32 * 1024,
		CheckOrigin: func(r *http.Request) bool {
			origin := r.Header.Get("Origin")
			if origin == "" {
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

// conn encapsule le WebSocket avec un mutex d'écriture.
type conn struct {
	ws      *websocket.Conn
	writeMu sync.Mutex
}

func (c *conn) send(msgType string, payload any) {
	type outMsg struct {
		Type    string `json:"type"`
		Payload any    `json:"payload"`
	}
	data, _ := json.Marshal(outMsg{Type: msgType, Payload: payload})
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	c.ws.WriteMessage(websocket.TextMessage, data)
}

func (c *conn) sendError(msg string) {
	c.send(msgError, map[string]string{"message": msg})
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	user := mw.GetUser(r)
	if user == nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("sftp ws upgrade: %v", err)
		return
	}
	defer wsConn.Close()

	c := &conn{ws: wsConn}

	// Premier message : connect
	_, raw, err := wsConn.ReadMessage()
	if err != nil {
		return
	}
	var first clientMsg
	if err := json.Unmarshal(raw, &first); err != nil || first.Type != msgConnect {
		c.sendError("expected connect message")
		return
	}

	var cp connectPayload
	if err := json.Unmarshal(first.Payload, &cp); err != nil || cp.HostID == "" || cp.Credential == "" {
		c.sendError("invalid connect payload")
		return
	}

	host, err := db.GetHostByID(r.Context(), h.pool, cp.HostID, user.UserID)
	if err != nil {
		c.sendError("host not found")
		return
	}

	sshCfg := &gossh.ClientConfig{
		User:            host.Username,
		HostKeyCallback: gossh.InsecureIgnoreHostKey(),
		Timeout:         15 * time.Second,
	}

	cred := cp.Credential
	switch host.AuthType {
	case "password":
		sshCfg.Auth = []gossh.AuthMethod{gossh.Password(cred)}
	case "key":
		signer, err := gossh.ParsePrivateKey([]byte(cred))
		if err != nil {
			c.sendError("invalid private key")
			return
		}
		sshCfg.Auth = []gossh.AuthMethod{gossh.PublicKeys(signer)}
	}

	sshClient, err := gossh.Dial("tcp", fmt.Sprintf("%s:%d", host.Hostname, host.Port), sshCfg)
	if err != nil {
		c.sendError(fmt.Sprintf("connection failed: %v", err))
		return
	}
	defer sshClient.Close()

	sftpClient, err := pkgsftp.NewClient(sshClient)
	if err != nil {
		c.sendError("failed to open SFTP subsystem")
		return
	}
	defer sftpClient.Close()

	home, err := sftpClient.Getwd()
	if err != nil {
		home = "/"
	}
	c.send(msgConnected, map[string]string{"home": home, "host_name": host.Name})

	// Boucle principale des messages SFTP
	for {
		_, raw, err := wsConn.ReadMessage()
		if err != nil {
			return
		}

		var msg clientMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}

		switch msg.Type {

		case msgLS:
			var p lsPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid ls payload")
				continue
			}
			if p.Path == "" {
				p.Path = home
			}
			infos, err := sftpClient.ReadDir(p.Path)
			if err != nil {
				c.sendError(fmt.Sprintf("ls: %v", err))
				continue
			}
			entries := make([]FileEntry, 0, len(infos))
			for _, fi := range infos {
				entries = append(entries, FileEntry{
					Name:    fi.Name(),
					Size:    fi.Size(),
					IsDir:   fi.IsDir(),
					Mode:    fi.Mode().String(),
					ModTime: fi.ModTime().Format(time.RFC3339),
				})
			}
			c.send(msgLSResult, map[string]any{"path": p.Path, "entries": entries})

		case msgGet:
			var p getPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid get payload")
				continue
			}
			f, err := sftpClient.Open(p.Path)
			if err != nil {
				c.sendError(fmt.Sprintf("open: %v", err))
				continue
			}
			data, err := io.ReadAll(f)
			f.Close()
			if err != nil {
				c.sendError(fmt.Sprintf("read: %v", err))
				continue
			}
			name := p.Path[strings.LastIndex(p.Path, "/")+1:]
			c.send(msgGetResult, map[string]string{
				"path": p.Path,
				"name": name,
				"data": base64.StdEncoding.EncodeToString(data),
			})

		case msgPut:
			var p putPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid put payload")
				continue
			}
			decoded, err := base64.StdEncoding.DecodeString(p.Data)
			if err != nil {
				c.sendError("invalid base64 data")
				continue
			}
			f, err := sftpClient.OpenFile(p.Path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC)
			if err != nil {
				c.sendError(fmt.Sprintf("create: %v", err))
				continue
			}
			_, err = f.Write(decoded)
			f.Close()
			if err != nil {
				c.sendError(fmt.Sprintf("write: %v", err))
				continue
			}
			c.send(msgDone, map[string]string{"op": "put", "path": p.Path})

		case msgRM:
			var p rmPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid rm payload")
				continue
			}
			if err := sftpClient.RemoveDirectory(p.Path); err != nil {
				if err := sftpClient.Remove(p.Path); err != nil {
					c.sendError(fmt.Sprintf("remove: %v", err))
					continue
				}
			}
			c.send(msgDone, map[string]string{"op": "rm", "path": p.Path})

		case msgMkdir:
			var p mkdirPayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid mkdir payload")
				continue
			}
			if err := sftpClient.Mkdir(p.Path); err != nil {
				c.sendError(fmt.Sprintf("mkdir: %v", err))
				continue
			}
			c.send(msgDone, map[string]string{"op": "mkdir", "path": p.Path})

		case msgRename:
			var p renamePayload
			if err := json.Unmarshal(msg.Payload, &p); err != nil {
				c.sendError("invalid rename payload")
				continue
			}
			if err := sftpClient.Rename(p.From, p.To); err != nil {
				c.sendError(fmt.Sprintf("rename: %v", err))
				continue
			}
			c.send(msgDone, map[string]string{"op": "rename", "from": p.From, "to": p.To})
		}
	}
}
