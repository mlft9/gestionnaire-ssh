package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/gestion-ssh/backend/internal/auth"
)

type contextKey string

const UserContextKey contextKey = "user"

type UserClaims struct {
	UserID  string
	Email   string
	IsAdmin bool
}

func Authenticate(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var tokenStr string

			// Priorité au cookie httpOnly
			if cookie, err := r.Cookie("access_token"); err == nil {
				tokenStr = cookie.Value
			} else {
				// Fallback: Authorization header
				bearer := r.Header.Get("Authorization")
				if strings.HasPrefix(bearer, "Bearer ") {
					tokenStr = strings.TrimPrefix(bearer, "Bearer ")
				}
			}

			if tokenStr == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			claims, err := auth.ValidateToken(jwtSecret, tokenStr)
			if err != nil || (claims.TokenType != "access" && claims.TokenType != "") {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, &UserClaims{
				UserID:  claims.UserID,
				Email:   claims.Email,
				IsAdmin: claims.IsAdmin,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUser(r *http.Request) *UserClaims {
	user, _ := r.Context().Value(UserContextKey).(*UserClaims)
	return user
}

// AuthenticateOrTOTPPending accepte les tokens "access" ET "totp_pending".
// Utilisé pour les endpoints de configuration 2FA accessibles pendant le setup obligatoire.
func AuthenticateOrTOTPPending(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var tokenStr string

			if cookie, err := r.Cookie("access_token"); err == nil {
				tokenStr = cookie.Value
			} else {
				bearer := r.Header.Get("Authorization")
				if strings.HasPrefix(bearer, "Bearer ") {
					tokenStr = strings.TrimPrefix(bearer, "Bearer ")
				}
			}

			if tokenStr == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			claims, err := auth.ValidateToken(jwtSecret, tokenStr)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			// Accepte "access", "totp_pending" ou "" (compat)
			if claims.TokenType != "access" && claims.TokenType != "totp_pending" && claims.TokenType != "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), UserContextKey, &UserClaims{
				UserID:  claims.UserID,
				Email:   claims.Email,
				IsAdmin: claims.IsAdmin,
			})
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user := GetUser(r)
		if user == nil || !user.IsAdmin {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
