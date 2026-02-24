package handlers

import (
	"encoding/json"
	"log"
	"net/http"
)

// DebugMode est activé via DEBUG=true dans le .env.
// En mode debug : les erreurs internes sont retournées dans la réponse JSON
// et loggées avec les détails complets.
var DebugMode bool

func jsonResponse(w http.ResponseWriter, data interface{}, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func jsonError(w http.ResponseWriter, message string, status int) {
	jsonResponse(w, map[string]string{"error": message}, status)
}

// jsonInternalError logue l'erreur réelle côté serveur.
// En mode debug, renvoie aussi les détails dans la réponse HTTP.
func jsonInternalError(w http.ResponseWriter, context string, err error) {
	log.Printf("[ERROR] %s: %v", context, err)
	if DebugMode {
		jsonError(w, context+": "+err.Error(), http.StatusInternalServerError)
	} else {
		jsonError(w, "internal error", http.StatusInternalServerError)
	}
}
