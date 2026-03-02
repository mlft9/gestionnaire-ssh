package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gestion-ssh/backend/internal/api"
	"github.com/gestion-ssh/backend/internal/api/handlers"
	"github.com/gestion-ssh/backend/internal/config"
	"github.com/gestion-ssh/backend/internal/db"
	"github.com/joho/godotenv"
)

func main() {
	_ = godotenv.Load()

	cfg := config.Load()

	if cfg.Debug {
		handlers.DebugMode = true
		log.Println("⚠ DEBUG MODE ENABLED — ne pas utiliser en production")
		log.Printf("  port           : %s", cfg.Port)
		log.Printf("  allowed_origins: %s", cfg.AllowedOrigins)
		log.Printf("  totp_required  : %v", cfg.TOTPRequired)
		log.Printf("  cors           : toutes les origines acceptées")
	}

	database, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("cannot connect to database: %v", err)
	}
	defer database.Close()

	if err := db.Migrate(database); err != nil {
		log.Fatalf("migration failed: %v", err)
	}

	router := api.NewRouter(cfg, database)

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           router,
		ReadHeaderTimeout: 15 * time.Second, // protège contre slow-loris (headers uniquement)
		IdleTimeout:       120 * time.Second,
		// ReadTimeout et WriteTimeout intentionnellement absents : gorilla/websocket v1.5
		// ne réinitialise pas les deadlines posées par le serveur HTTP après le hijack,
		// ce qui tuerait les sessions WebSocket actives au bout de ces délais.
	}

	go func() {
		log.Printf("server listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("server error: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("forced shutdown: %v", err)
	}
	log.Println("server exited")
}
