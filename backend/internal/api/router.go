package api

import (
	"net/http"
	"strings"
	"time"

	"github.com/gestion-ssh/backend/internal/api/handlers"
	mw "github.com/gestion-ssh/backend/internal/api/middleware"
	"github.com/gestion-ssh/backend/internal/config"
	sftpws "github.com/gestion-ssh/backend/internal/sftp"
	"github.com/gestion-ssh/backend/internal/ws"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"
)

func NewRouter(cfg *config.Config, pool *pgxpool.Pool) http.Handler {
	r := chi.NewRouter()

	// ─── Middlewares globaux ───────────────────────────────────────────────────
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(60 * time.Second))

	// CORS
	origins := strings.Split(cfg.AllowedOrigins, ",")
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// ─── Handlers ─────────────────────────────────────────────────────────────
	authHandler := handlers.NewAuthHandler(pool, cfg)
	hostHandler := handlers.NewHostHandler(pool)
	credentialHandler := handlers.NewCredentialHandler(pool)
	settingsHandler := handlers.NewSettingsHandler(pool, cfg)
	initHandler := handlers.NewInitHandler(pool)
	totpHandler := handlers.NewTOTPHandler(pool, cfg)
	wsHandler := ws.NewHandler(pool, origins)
	sftpHandler := sftpws.NewHandler(pool, origins)

	// ─── Routes init (first-launch) ───────────────────────────────────────────
	r.Get("/api/init/status", initHandler.Status)
	r.Post("/api/init", initHandler.Init)

	// ─── Routes publiques ─────────────────────────────────────────────────────
	r.Route("/api/auth", func(r chi.Router) {
		r.Use(mw.RateLimit(10, time.Minute))
		r.Post("/register", authHandler.Register)
		r.Post("/login", authHandler.Login)
		r.Post("/refresh", authHandler.Refresh)
		r.Post("/logout", authHandler.Logout)
		// Étape 2 login 2FA (utilise le totp_pending token dans le body)
		r.Post("/2fa/verify", totpHandler.Verify)
	})

	// ─── Paramètres publics (lecture seule) ───────────────────────────────────
	r.Get("/api/settings/registration", settingsHandler.GetRegistration)
	r.Get("/api/settings/totp-required", settingsHandler.GetTOTPRequired)

	// ─── Routes authentifiées (access token) ──────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(mw.Authenticate(cfg.JWTSecret))

		r.Get("/api/auth/me", authHandler.Me)
		r.Put("/api/auth/profile", authHandler.UpdateProfile)

		// Hosts CRUD
		r.Route("/api/hosts", func(r chi.Router) {
			r.Get("/", hostHandler.List)
			r.Post("/", hostHandler.Create)
			r.Get("/{id}", hostHandler.Get)
			r.Put("/{id}", hostHandler.Update)
			r.Delete("/{id}", hostHandler.Delete)
		})

		// Credentials vault CRUD
		r.Route("/api/credentials", func(r chi.Router) {
			r.Get("/", credentialHandler.List)
			r.Post("/", credentialHandler.Create)
			r.Delete("/{id}", credentialHandler.Delete)
		})

		// 2FA — désactivation (requiert d'être connecté)
		r.Post("/api/auth/2fa/disable", totpHandler.Disable)

		// WebSocket SSH terminal
		r.Get("/ws/ssh", wsHandler.ServeHTTP)
		// WebSocket SFTP
		r.Get("/ws/sftp", sftpHandler.ServeHTTP)
	})

	// ─── Routes 2FA setup (access OU totp_pending) ────────────────────────────
	// Accessibles avec un token "access" (depuis le dashboard) OU
	// avec un "totp_pending" (setup obligatoire juste après le login)
	r.Group(func(r chi.Router) {
		r.Use(mw.AuthenticateOrTOTPPending(cfg.JWTSecret))
		r.Get("/api/auth/2fa/setup", totpHandler.Setup)
		r.Post("/api/auth/2fa/enable", totpHandler.Enable)
	})

	// ─── Routes admin ─────────────────────────────────────────────────────────
	r.Group(func(r chi.Router) {
		r.Use(mw.Authenticate(cfg.JWTSecret))
		r.Use(mw.RequireAdmin)
		r.Put("/api/settings/registration", settingsHandler.SetRegistration)
	})

	// ─── Health check ─────────────────────────────────────────────────────────
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	return r
}
