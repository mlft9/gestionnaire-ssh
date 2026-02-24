package ws

import "encoding/json"

type MessageType string

const (
	// Client -> Serveur
	MsgConnect    MessageType = "connect"
	MsgInput      MessageType = "input"
	MsgResize     MessageType = "resize"
	MsgDisconnect MessageType = "disconnect"

	// Serveur -> Client
	MsgOutput    MessageType = "output"
	MsgConnected MessageType = "connected"
	MsgError     MessageType = "error"
	MsgClosed    MessageType = "closed"
)

type ClientMessage struct {
	Type    MessageType     `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type ServerMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload"`
}

// Payloads client (hors ConnectPayload qui est dans package ssh)
type InputPayload struct {
	Data string `json:"data"`
}

type ResizePayload struct {
	Cols uint16 `json:"cols"`
	Rows uint16 `json:"rows"`
}

// Payloads serveur
type OutputPayload struct {
	Data string `json:"data"`
}

type ErrorPayload struct {
	Message string `json:"message"`
}

type ConnectedPayload struct {
	SessionID string `json:"session_id"`
	HostName  string `json:"host_name"`
}
