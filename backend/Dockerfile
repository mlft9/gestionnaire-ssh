FROM golang:1.22-alpine AS builder

WORKDIR /app

# Dependances systeme pour CGO (argon2)
RUN apk add --no-cache gcc musl-dev

# Copier les sources en entier puis resoudre les dependances
COPY . .
RUN go mod tidy && go mod download

RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o server ./cmd/server

# Image finale minimale
FROM alpine:3.19
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app
COPY --from=builder /app/server .

EXPOSE 8080
CMD ["./server"]
