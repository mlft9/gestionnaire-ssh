package middleware

import (
	"net/http"
	"sync"
	"time"
)

type rateLimiter struct {
	mu       sync.Mutex
	requests map[string][]time.Time
	limit    int
	window   time.Duration
}

func newRateLimiter(limit int, window time.Duration) *rateLimiter {
	rl := &rateLimiter{
		requests: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}
	// Nettoyage périodique
	go func() {
		for range time.Tick(window) {
			rl.mu.Lock()
			cutoff := time.Now().Add(-window)
			for ip, times := range rl.requests {
				filtered := times[:0]
				for _, t := range times {
					if t.After(cutoff) {
						filtered = append(filtered, t)
					}
				}
				if len(filtered) == 0 {
					delete(rl.requests, ip)
				} else {
					rl.requests[ip] = filtered
				}
			}
			rl.mu.Unlock()
		}
	}()
	return rl
}

func (rl *rateLimiter) allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	cutoff := now.Add(-rl.window)

	times := rl.requests[ip]
	filtered := times[:0]
	for _, t := range times {
		if t.After(cutoff) {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) >= rl.limit {
		rl.requests[ip] = filtered
		return false
	}
	rl.requests[ip] = append(filtered, now)
	return true
}

// RateLimit crée un middleware de rate limiting (5 req/min par IP par défaut).
func RateLimit(limit int, window time.Duration) func(http.Handler) http.Handler {
	rl := newRateLimiter(limit, window)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// X-Real-IP est positionné par nginx ($remote_addr) et non falsifiable par le client.
			// X-Forwarded-For peut être forgé par l'attaquant → ignoré.
			ip := r.RemoteAddr
			if realIP := r.Header.Get("X-Real-IP"); realIP != "" {
				ip = realIP
			}
			if !rl.allow(ip) {
				http.Error(w, `{"error":"too many requests"}`, http.StatusTooManyRequests)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
