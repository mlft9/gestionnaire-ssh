package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	KDFSalt      []byte    `json:"kdf_salt"`
	KDFParams    []byte    `json:"kdf_params"`
	IsAdmin      bool      `json:"is_admin"`
	TOTPEnabled  bool      `json:"totp_enabled"`
	CreatedAt    time.Time `json:"created_at"`
}

type Host struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Name          string    `json:"name"`
	Hostname      string    `json:"hostname"`
	Port          int       `json:"port"`
	Username      string    `json:"username"`
	AuthType      string    `json:"auth_type"`
	EncryptedCred []byte    `json:"encrypted_cred"`
	IV            []byte    `json:"iv"`
	Tags          []string  `json:"tags"`
	Icon          string    `json:"icon"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type CreateHostInput struct {
	Name          string   `json:"name"`
	Hostname      string   `json:"hostname"`
	Port          int      `json:"port"`
	Username      string   `json:"username"`
	AuthType      string   `json:"auth_type"`
	EncryptedCred []byte   `json:"encrypted_cred"`
	IV            []byte   `json:"iv"`
	Tags          []string `json:"tags"`
	Icon          string   `json:"icon"`
}

type Credential struct {
	ID            string    `json:"id"`
	UserID        string    `json:"user_id"`
	Name          string    `json:"name"`
	Type          string    `json:"type"` // "key" | "password"
	EncryptedCred []byte    `json:"encrypted_cred"`
	IV            []byte    `json:"iv"`
	CreatedAt     time.Time `json:"created_at"`
}

type CreateCredentialInput struct {
	Name          string `json:"name"`
	Type          string `json:"type"`
	EncryptedCred []byte `json:"encrypted_cred"`
	IV            []byte `json:"iv"`
}

type Session struct {
	ID        string     `json:"id"`
	UserID    string     `json:"user_id"`
	HostID    string     `json:"host_id"`
	StartedAt time.Time  `json:"started_at"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
	ClientIP  string     `json:"client_ip"`
}
