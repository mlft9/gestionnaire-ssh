/**
 * Service WebSocket pour le terminal SSH.
 *
 * Flux :
 *   1. Connexion WS (authentifié via cookie httpOnly)
 *   2. Envoi du message "connect" avec { host_id, credential (clair) }
 *   3. Le serveur répond "connected" ou "error"
 *   4. Boucle bidirectionnelle : input/resize → WS → SSH → output → xterm.js
 */

export type WSMessageType =
  | 'connect' | 'input' | 'resize' | 'disconnect'
  | 'output' | 'connected' | 'error' | 'closed'

export interface WSMessage {
  type: WSMessageType
  payload: unknown
}

export interface ConnectPayload {
  host_id: string
  credential: string  // Déchiffré côté client — transit TLS uniquement
  cols: number
  rows: number
}

export interface TerminalCallbacks {
  onOutput: (data: string) => void
  onConnected: (sessionId: string, hostName: string) => void
  onError: (message: string) => void
  onClosed: () => void
}

export class TerminalService {
  private ws: WebSocket | null = null
  private callbacks: TerminalCallbacks

  constructor(callbacks: TerminalCallbacks) {
    this.callbacks = callbacks
  }

  connect(connectPayload: ConnectPayload): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/ssh`

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      // Premier message : initiation de la session SSH
      this.send('connect', connectPayload)
    }

    this.ws.onmessage = (event) => {
      try {
        const msg: WSMessage = JSON.parse(event.data)
        this.handleMessage(msg)
      } catch {
        console.error('Invalid WS message:', event.data)
      }
    }

    this.ws.onclose = () => {
      this.callbacks.onClosed()
    }

    this.ws.onerror = () => {
      this.callbacks.onError('Erreur de connexion WebSocket')
    }
  }

  private handleMessage(msg: WSMessage): void {
    switch (msg.type) {
      case 'output': {
        const payload = msg.payload as { data: string }
        this.callbacks.onOutput(payload.data)
        break
      }
      case 'connected': {
        const payload = msg.payload as { session_id: string; host_name: string }
        this.callbacks.onConnected(payload.session_id, payload.host_name)
        break
      }
      case 'error': {
        const payload = msg.payload as { message: string }
        this.callbacks.onError(payload.message)
        break
      }
      case 'closed': {
        this.callbacks.onClosed()
        break
      }
    }
  }

  sendInput(data: string): void {
    this.send('input', { data })
  }

  sendResize(cols: number, rows: number): void {
    this.send('resize', { cols, rows })
  }

  disconnect(): void {
    this.send('disconnect', {})
    this.ws?.close()
    this.ws = null
  }

  private send(type: WSMessageType, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }))
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
