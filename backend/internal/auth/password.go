package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	argonMemory      = 64 * 1024 // 64 MB
	argonIterations  = 3
	argonParallelism = 4
	argonSaltLen     = 16
	argonKeyLen      = 32
)

// HashPassword génère un hash Argon2id pour stocker le mot de passe côté serveur.
// NB: ceci est distinct de la dérivation de la MasterKey (côté client).
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey(
		[]byte(password), salt,
		argonIterations, argonMemory, argonParallelism, argonKeyLen,
	)
	encoded := fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argonMemory, argonIterations, argonParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(hash),
	)
	return encoded, nil
}

func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 {
		return false, errors.New("invalid hash format")
	}
	var memory, iterations uint32
	var parallelism uint8
	_, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &parallelism)
	if err != nil {
		return false, err
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	storedHash, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false, err
	}
	computedHash := argon2.IDKey(
		[]byte(password), salt,
		iterations, memory, parallelism, uint32(len(storedHash)),
	)
	return subtle.ConstantTimeCompare(storedHash, computedHash) == 1, nil
}

// GenerateKDFSalt génère un sel aléatoire pour la dérivation de la MasterKey côté client.
func GenerateKDFSalt() ([]byte, error) {
	salt := make([]byte, 32)
	_, err := rand.Read(salt)
	return salt, err
}
