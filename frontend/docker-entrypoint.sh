#!/bin/sh
set -e

CERT_DIR=/etc/nginx/ssl

if [ ! -f "$CERT_DIR/cert.pem" ]; then
    mkdir -p "$CERT_DIR"

    # Build SAN list (always include localhost)
    SAN="DNS:localhost,IP:127.0.0.1"

    if [ -n "$SERVER_NAME" ]; then
        case "$SERVER_NAME" in
            # IP address pattern
            [0-9]*.[0-9]*.[0-9]*.[0-9]*)
                SAN="$SAN,IP:$SERVER_NAME"
                ;;
            *)
                SAN="$SAN,DNS:$SERVER_NAME"
                ;;
        esac
    fi

    echo "Generating self-signed certificate (SAN: $SAN)..."
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout "$CERT_DIR/key.pem" \
        -out  "$CERT_DIR/cert.pem" \
        -subj "/CN=${SERVER_NAME:-localhost}" \
        -addext "subjectAltName=$SAN" 2>/dev/null
    echo "Certificate generated."
fi

exec nginx -g 'daemon off;'
