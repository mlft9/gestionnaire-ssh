package config

import (
	"log"
	"os"
)

type Config struct {
	DatabaseURL    string
	JWTSecret      string
	Port           string
	AllowedOrigins string
	TOTPRequired   bool
}

func Load() *Config {
	cfg := &Config{
		DatabaseURL:    getEnv("DATABASE_URL", "postgres://sshmanager:changeme@localhost:5432/sshmanager?sslmode=disable"),
		JWTSecret:      getEnv("JWT_SECRET", ""),
		Port:           getEnv("PORT", "8080"),
		AllowedOrigins: getEnv("ALLOWED_ORIGINS", "http://localhost:5173"),
		TOTPRequired:   getEnv("TOTP_REQUIRED", "false") == "true",
	}

	if cfg.JWTSecret == "" {
		log.Fatal("JWT_SECRET environment variable is required")
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}
