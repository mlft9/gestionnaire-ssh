package auth

import (
	"sync"
	"time"

	"github.com/pquerna/otp/totp"
)

// TOTPSetup contient les données retournées lors de la génération d'un secret TOTP.
type TOTPSetup struct {
	Secret     string // base32 secret
	OTPAuthURL string // otpauth:// URI (pour génération QR côté client)
}

// GenerateTOTPSecret génère un nouveau secret TOTP et retourne
// le secret base32 et l'URI otpauth:// (le QR est généré côté frontend).
func GenerateTOTPSecret(email, issuer string) (*TOTPSetup, error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: email,
	})
	if err != nil {
		return nil, err
	}

	return &TOTPSetup{
		Secret:     key.Secret(),
		OTPAuthURL: key.String(),
	}, nil
}

// ── Protection anti-rejeu ────────────────────────────────────────────────────
// Un code TOTP valide ne peut être accepté qu'une seule fois dans sa fenêtre.
// On stocke "secret:code" → heure d'expiration pendant 90 secondes (3 fenêtres).

var (
	usedCodes   sync.Map
	cleanupOnce sync.Once
)

func startTOTPCleanup() {
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			now := time.Now()
			usedCodes.Range(func(k, v any) bool {
				if v.(time.Time).Before(now) {
					usedCodes.Delete(k)
				}
				return true
			})
		}
	}()
}

// ValidateTOTP vérifie un code TOTP à 6 chiffres contre un secret base32
// et le marque comme consommé pour éviter les attaques par rejeu.
func ValidateTOTP(code, secret string) bool {
	cleanupOnce.Do(startTOTPCleanup)

	if !totp.Validate(code, secret) {
		return false
	}

	// LoadOrStore : si la clé existe déjà, le code a déjà été utilisé → rejet.
	key := secret + ":" + code
	_, alreadyUsed := usedCodes.LoadOrStore(key, time.Now().Add(90*time.Second))
	return !alreadyUsed
}
