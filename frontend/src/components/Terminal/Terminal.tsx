/**
 * Composant Terminal — monte xterm.js et connecte le WebSocket SSH.
 *
 * Le credential est :
 *   1. Récupéré du serveur (chiffré)
 *   2. Déchiffré localement avec la MasterKey
 *   3. Envoyé au serveur via WS (TLS uniquement)
 *   4. Jamais stocké ou loggué
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Loader2, Wifi, WifiOff, AlertCircle } from 'lucide-react'
import { hostsApi, Host } from '../../services/api'
import { decryptCredential } from '../../crypto'
import { useAuthStore } from '../../store/auth'
import { TerminalService } from '../../services/terminal'

interface Props {
  hostId: string
}

type ConnectionState = 'loading' | 'connecting' | 'connected' | 'error' | 'closed'

export default function Terminal({ hostId }: Props) {
  const masterKey = useAuthStore((s) => s.masterKey)
  const termRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const serviceRef = useRef<TerminalService | null>(null)

  const [state, setState] = useState<ConnectionState>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [host, setHost] = useState<Host | null>(null)
  const [sessionId, setSessionId] = useState('')

  // Initialise xterm.js
  const initXterm = useCallback(() => {
    if (!termRef.current || xtermRef.current) return

    const xterm = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#c9d1d9',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#484f58',
        brightBlack: '#6e7681',
        red: '#ff7b72',
        brightRed: '#ffa198',
        green: '#3fb950',
        brightGreen: '#56d364',
        yellow: '#d29922',
        brightYellow: '#e3b341',
        blue: '#58a6ff',
        brightBlue: '#79c0ff',
        magenta: '#bc8cff',
        brightMagenta: '#d2a8ff',
        cyan: '#39c5cf',
        brightCyan: '#56d4dd',
        white: '#b1bac4',
        brightWhite: '#f0f6fc',
      },
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowTransparency: false,
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    xterm.loadAddon(fitAddon)
    xterm.loadAddon(webLinksAddon)
    xterm.open(termRef.current)
    fitAddon.fit()

    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    return { xterm, fitAddon }
  }, [])

  // Connexion SSH
  useEffect(() => {
    if (!masterKey) return
    const key: CryptoKey = masterKey  // capture non-nullable pour les closures

    let cancelled = false
    const resizeObserver = new ResizeObserver(() => {
      fitAddonRef.current?.fit()
      if (serviceRef.current && xtermRef.current) {
        serviceRef.current.sendResize(
          xtermRef.current.cols,
          xtermRef.current.rows
        )
      }
    })

    async function init() {
      // 1. Récupérer l'hôte
      setState('loading')
      let hostData: Host
      try {
        const { data } = await hostsApi.get(hostId)
        hostData = data
        if (cancelled) return
        setHost(hostData)
      } catch {
        setState('error')
        setErrorMsg('Hôte introuvable')
        return
      }

      // 2. Déchiffrer le credential
      let credential: string
      try {
        credential = await decryptCredential(key, {
          encryptedCred: hostData.encrypted_cred,
          iv: hostData.iv,
        })
      } catch {
        setState('error')
        setErrorMsg('Impossible de déchiffrer les credentials')
        return
      }

      if (cancelled) {
        credential = '\x00'.repeat(credential.length)
        return
      }

      // 3. Init xterm
      const result = initXterm()
      if (!result) return
      const { xterm, fitAddon } = result

      // 4. Observer le resize
      if (termRef.current) {
        resizeObserver.observe(termRef.current)
      }

      // 5. Connecter le WebSocket
      setState('connecting')
      const service = new TerminalService({
        onOutput: (data) => xterm.write(data),
        onConnected: (sid) => {
          setSessionId(sid)
          setState('connected')
          xterm.focus()
        },
        onError: (msg) => {
          setState('error')
          setErrorMsg(msg)
        },
        onClosed: () => setState('closed'),
      })
      serviceRef.current = service

      service.connect({
        host_id: hostId,
        credential,
        cols: xterm.cols,
        rows: xterm.rows,
      })

      // Zero-out le credential dès qu'il n'est plus nécessaire
      credential = '\x00'.repeat(credential.length)

      // 6. Input xterm → SSH
      xterm.onData((data) => service.sendInput(data))

      // 7. Resize
      xterm.onResize(({ cols, rows }) => {
        service.sendResize(cols, rows)
      })

      fitAddon.fit()
    }

    init()

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      serviceRef.current?.disconnect()
      xtermRef.current?.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      serviceRef.current = null
    }
  }, [hostId, masterKey, initXterm])

  return (
    <div className="flex flex-col h-full bg-surface-900">
      {/* Barre de statut */}
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-b border-surface-700 text-xs">
        <StatusBadge state={state} />
        {host && (
          <span className="text-gray-400 font-mono">
            {host.username}@{host.hostname}:{host.port}
          </span>
        )}
        {sessionId && (
          <span className="text-gray-600 ml-auto">session: {sessionId.slice(0, 8)}…</span>
        )}
      </div>

      {/* Terminal xterm.js */}
      <div className="flex-1 relative overflow-hidden">
        <div ref={termRef} className="absolute inset-0" />

        {/* Overlay états */}
        {state !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-900/90">
            {state === 'loading' && (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-sm">Chargement…</span>
              </div>
            )}
            {state === 'connecting' && (
              <div className="flex items-center gap-2 text-gray-400">
                <Loader2 className="w-5 h-5 animate-spin text-accent-400" />
                <span className="text-sm">Connexion SSH…</span>
              </div>
            )}
            {state === 'error' && (
              <div className="flex flex-col items-center gap-3 text-center">
                <AlertCircle className="w-8 h-8 text-danger" />
                <div>
                  <p className="text-sm font-medium text-gray-200">Erreur de connexion</p>
                  <p className="text-xs text-gray-500 mt-1">{errorMsg}</p>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="btn-ghost text-xs py-1.5"
                >
                  Réessayer
                </button>
              </div>
            )}
            {state === 'closed' && (
              <div className="flex flex-col items-center gap-3 text-center">
                <WifiOff className="w-8 h-8 text-gray-500" />
                <div>
                  <p className="text-sm font-medium text-gray-400">Session terminée</p>
                  <p className="text-xs text-gray-600 mt-1">La connexion SSH a été fermée</p>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="btn-ghost text-xs py-1.5"
                >
                  Reconnecter
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ state }: { state: ConnectionState }) {
  const configs = {
    loading:    { color: 'text-gray-500', icon: <Loader2 className="w-3 h-3 animate-spin" />, label: 'Chargement' },
    connecting: { color: 'text-warning',  icon: <Loader2 className="w-3 h-3 animate-spin" />, label: 'Connexion' },
    connected:  { color: 'text-success',  icon: <Wifi className="w-3 h-3" />,                  label: 'Connecté' },
    error:      { color: 'text-danger',   icon: <WifiOff className="w-3 h-3" />,               label: 'Erreur' },
    closed:     { color: 'text-gray-500', icon: <WifiOff className="w-3 h-3" />,               label: 'Fermé' },
  }
  const { color, icon, label } = configs[state]
  return (
    <span className={`flex items-center gap-1.5 font-medium ${color}`}>
      {icon}
      {label}
    </span>
  )
}
