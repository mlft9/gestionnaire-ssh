# SSH Manager — V1

Gestionnaire de terminaux SSH/SFTP via panel web avec chiffrement de bout en bout (E2EE).

## Stack

| Couche | Techno |
|--------|--------|
| Frontend | React + TypeScript + Vite + TailwindCSS |
| Terminal | xterm.js v5 |
| Backend | Go 1.22 + chi + gorilla/websocket |
| SSH | golang.org/x/crypto/ssh |
| Base de données | PostgreSQL 16 |
| Crypto E2EE | Argon2id (WASM) + AES-256-GCM (Web Crypto API) |
| Auth | JWT (httpOnly cookies) + Argon2id (password hash) |

## Démarrage rapide

```bash
# 1. Copier la configuration
cp .env.example .env
# Modifier JWT_SECRET avec une valeur aléatoire forte

# 2. Lancer avec Docker Compose
docker compose up --build

# Frontend : http://localhost:5173
# Backend  : http://localhost:8080
# Health   : http://localhost:8080/health
```

## Développement local

### Backend Go
```bash
cd backend
go mod tidy
go run ./cmd/server
```

### Frontend React
```bash
cd frontend
npm install
npm run dev
```

## Architecture E2EE

```
Mot de passe utilisateur
    │
    ▼ Argon2id (WASM, côté navigateur)
MasterKey (AES-256, NON EXTRACTABLE, jamais envoyée au serveur)
    │
    ├── Stocker un credential SSH
    │   └── AES-256-GCM(MasterKey, credential) → encrypted_cred + IV → PostgreSQL
    │
    └── Se connecter à un hôte SSH
        ├── GET /api/hosts/:id → { encrypted_cred, IV }
        ├── Déchiffrement local (MasterKey)
        ├── WS /ws/ssh → { host_id, credential_en_clair } (TLS uniquement)
        ├── Serveur Go : SSH Dial() → hôte cible (credential en RAM uniquement)
        └── Zero-memory credential après usage
```

## Structure du projet

```
gestion-ssh/
├── backend/
│   ├── cmd/server/main.go
│   └── internal/
│       ├── api/         # REST handlers + router + middleware
│       ├── auth/        # JWT + Argon2id
│       ├── db/          # PostgreSQL + migrations
│       ├── models/      # Types de données
│       ├── ssh/         # Proxy SSH
│       └── ws/          # WebSocket handler + messages
└── frontend/
    └── src/
        ├── crypto/      # Argon2id + AES-256-GCM (Web Crypto API)
        ├── services/    # API axios + WebSocket terminal
        ├── store/       # Zustand (auth + masterKey)
        ├── components/  # HostCard, HostForm, Terminal
        └── pages/       # Login, Register, Dashboard, Terminal
```

## Endpoints API

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | /api/auth/register | Non | Création de compte |
| POST | /api/auth/login | Non | Connexion |
| POST | /api/auth/refresh | Cookie | Refresh JWT |
| POST | /api/auth/logout | Non | Déconnexion |
| GET | /api/auth/me | JWT | Profil utilisateur |
| GET | /api/hosts | JWT | Liste des hôtes |
| POST | /api/hosts | JWT | Créer un hôte |
| GET | /api/hosts/:id | JWT | Détail d'un hôte |
| PUT | /api/hosts/:id | JWT | Modifier un hôte |
| DELETE | /api/hosts/:id | JWT | Supprimer un hôte |
| GET (WS) | /ws/ssh | JWT | Terminal SSH |
