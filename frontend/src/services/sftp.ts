export interface FileEntry {
  name: string
  size: number
  is_dir: boolean
  mode: string
  mod_time: string
}

export interface SFTPCallbacks {
  onConnected: (home: string, hostName: string) => void
  onLSResult: (path: string, entries: FileEntry[]) => void
  onGetResult: (name: string, data: string) => void
  onDone: (op: string, detail: Record<string, string>) => void
  onError: (message: string) => void
  onClose: () => void
}

export class SFTPService {
  private ws: WebSocket | null = null
  private callbacks: SFTPCallbacks

  constructor(callbacks: SFTPCallbacks) {
    this.callbacks = callbacks
  }

  connect(hostId: string, credential: string): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws/sftp`)

    this.ws.onopen = () => {
      this.send('connect', { host_id: hostId, credential })
    }

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as { type: string; payload: unknown }
        this.handleMessage(msg)
      } catch {
        // ignore malformed
      }
    }

    this.ws.onclose = () => this.callbacks.onClose()
    this.ws.onerror = () => this.callbacks.onError('Erreur WebSocket SFTP')
  }

  private handleMessage(msg: { type: string; payload: unknown }): void {
    const p = msg.payload as Record<string, string>
    switch (msg.type) {
      case 'connected':
        this.callbacks.onConnected(p.home, p.host_name)
        break
      case 'ls_result': {
        const r = msg.payload as { path: string; entries: FileEntry[] }
        this.callbacks.onLSResult(r.path, r.entries ?? [])
        break
      }
      case 'get_result':
        this.callbacks.onGetResult(p.name, p.data)
        break
      case 'done':
        this.callbacks.onDone(p.op, p)
        break
      case 'error':
        this.callbacks.onError(p.message)
        break
    }
  }

  ls(path: string): void        { this.send('ls',     { path }) }
  get(path: string): void       { this.send('get',    { path }) }
  put(path: string, data: string): void { this.send('put', { path, data }) }
  rm(path: string): void        { this.send('rm',     { path }) }
  mkdir(path: string): void     { this.send('mkdir',  { path }) }
  rename(from: string, to: string): void { this.send('rename', { from, to }) }

  disconnect(): void {
    this.ws?.close()
    this.ws = null
  }

  private send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }))
    }
  }
}
