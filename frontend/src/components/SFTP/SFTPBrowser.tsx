import { useEffect, useRef, useState } from 'react'
import {
  Loader2, AlertCircle, Folder, File, Download, Trash2,
  FolderPlus, Upload, ChevronRight, Home, RefreshCw,
} from 'lucide-react'
import { hostsApi, Host } from '../../services/api'
import { decryptCredential } from '../../crypto'
import { useAuthStore } from '../../store/auth'
import { SFTPService, FileEntry } from '../../services/sftp'

interface Props {
  hostId: string
}

type Status = 'loading' | 'connecting' | 'connected' | 'error'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function buildBreadcrumb(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  return ['/', ...parts.map((_, i) => '/' + parts.slice(0, i + 1).join('/'))]
}

export default function SFTPBrowser({ hostId }: Props) {
  const masterKey = useAuthStore((s) => s.masterKey)
  const serviceRef = useRef<SFTPService | null>(null)

  const [status, setStatus] = useState<Status>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [host, setHost] = useState<Host | null>(null)
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [pathLoading, setPathLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [mkdirName, setMkdirName] = useState('')
  const [showMkdir, setShowMkdir] = useState(false)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  const uploadRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!masterKey) return
    const key: CryptoKey = masterKey

    let cancelled = false

    async function init() {
      // 1. Hôte
      let hostData: Host
      try {
        const { data } = await hostsApi.get(hostId)
        hostData = data
        if (cancelled) return
        setHost(hostData)
      } catch {
        setStatus('error')
        setErrorMsg('Hôte introuvable')
        return
      }

      // 2. Déchiffrer credential
      let credential: string
      try {
        credential = await decryptCredential(key, {
          encryptedCred: hostData.encrypted_cred,
          iv: hostData.iv,
        })
      } catch {
        setStatus('error')
        setErrorMsg('Impossible de déchiffrer le credential')
        return
      }

      if (cancelled) return

      // 3. Connexion SFTP
      setStatus('connecting')
      const svc = new SFTPService({
        onConnected: (home) => {
          if (cancelled) return
          setStatus('connected')
          setCurrentPath(home)
          navigate(home, svc)
        },
        onLSResult: (path, newEntries) => {
          setCurrentPath(path)
          setEntries(newEntries.sort((a, b) => {
            if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
            return a.name.localeCompare(b.name)
          }))
          setPathLoading(false)
        },
        onGetResult: (name, data) => {
          // Déclenche le téléchargement dans le navigateur
          const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
          const blob = new Blob([bytes])
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = name
          a.click()
          URL.revokeObjectURL(url)
        },
        onDone: (op, detail) => {
          if (op === 'rm' || op === 'put' || op === 'mkdir' || op === 'rename') {
            navigate(currentPath, svc)
          }
          if (op === 'rename') {
            setRenameTarget(null)
            setRenameTo('')
          }
          if (detail) setDeleteConfirm(null)
        },
        onError: (msg) => {
          setPathLoading(false)
          setErrorMsg(msg)
          if (status !== 'connected') setStatus('error')
        },
        onClose: () => setStatus('error'),
      })

      serviceRef.current = svc
      svc.connect(hostId, credential)
      credential = '\x00'.repeat(credential.length)
    }

    init()
    return () => {
      cancelled = true
      serviceRef.current?.disconnect()
      serviceRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, masterKey])

  function navigate(path: string, svc?: SFTPService) {
    const service = svc ?? serviceRef.current
    if (!service) return
    setPathLoading(true)
    service.ls(path)
  }

  function handleDownload(entry: FileEntry) {
    const path = currentPath.replace(/\/$/, '') + '/' + entry.name
    serviceRef.current?.get(path)
  }

  function handleDelete(entry: FileEntry) {
    const path = currentPath.replace(/\/$/, '') + '/' + entry.name
    setDeleteConfirm(path)
  }

  function confirmDelete() {
    if (!deleteConfirm) return
    serviceRef.current?.rm(deleteConfirm)
  }

  function handleMkdir() {
    if (!mkdirName.trim()) return
    const path = currentPath.replace(/\/$/, '') + '/' + mkdirName.trim()
    serviceRef.current?.mkdir(path)
    setMkdirName('')
    setShowMkdir(false)
  }

  function handleRename() {
    if (!renameTarget || !renameTo.trim()) return
    const dir = currentPath.replace(/\/$/, '')
    serviceRef.current?.rename(renameTarget, dir + '/' + renameTo.trim())
  }

  function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !serviceRef.current) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(',')[1]
      const path = currentPath.replace(/\/$/, '') + '/' + file.name
      serviceRef.current!.put(path, base64)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  // ── États non connectés ───────────────────────────────────────────────────
  if (status !== 'connected') {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-surface-900 text-sm">
        {status === 'loading' && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin" /> Chargement…
          </div>
        )}
        {status === 'connecting' && (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin text-accent-400" /> Connexion SFTP…
          </div>
        )}
        {status === 'error' && (
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-danger" />
            <p className="text-gray-300 font-medium">Erreur SFTP</p>
            <p className="text-xs text-gray-500">{errorMsg}</p>
          </div>
        )}
      </div>
    )
  }

  const breadcrumb = buildBreadcrumb(currentPath)

  return (
    <div className="flex flex-col h-full bg-surface-900">

      {/* Barre supérieure */}
      <div className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-b border-surface-700 shrink-0">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-xs text-gray-400 flex-1 min-w-0 overflow-x-auto">
          {breadcrumb.map((segment, i) => (
            <span key={segment} className="flex items-center gap-1 shrink-0">
              {i > 0 && <ChevronRight className="w-3 h-3 text-gray-600" />}
              <button
                onClick={() => navigate(segment)}
                className={`hover:text-gray-200 transition-colors ${
                  i === breadcrumb.length - 1 ? 'text-gray-100 font-medium' : ''
                }`}
              >
                {i === 0 ? <Home className="w-3.5 h-3.5" /> : segment.split('/').pop()}
              </button>
            </span>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => navigate(currentPath)}
            className="btn-ghost p-1.5"
            title="Actualiser"
            disabled={pathLoading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${pathLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowMkdir(true)}
            className="btn-ghost p-1.5"
            title="Nouveau dossier"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => uploadRef.current?.click()}
            className="btn-ghost p-1.5"
            title="Uploader un fichier"
          >
            <Upload className="w-3.5 h-3.5" />
          </button>
          <input ref={uploadRef} type="file" className="hidden" onChange={handleUpload} />
        </div>

        {host && (
          <span className="text-xs text-gray-500 font-mono shrink-0">
            {host.username}@{host.hostname}
          </span>
        )}
      </div>

      {/* Infobarre erreur inline */}
      {errorMsg && status === 'connected' && (
        <div className="px-4 py-2 bg-danger/10 border-b border-danger/20 text-xs text-danger flex items-center justify-between">
          {errorMsg}
          <button onClick={() => setErrorMsg('')} className="hover:text-danger/60">×</button>
        </div>
      )}

      {/* Liste des fichiers */}
      <div className="flex-1 overflow-y-auto">
        {pathLoading ? (
          <div className="flex items-center justify-center py-16 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Chargement…
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-gray-600 text-sm">
            Dossier vide
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-700 text-xs text-gray-500">
                <th className="text-left px-4 py-2 font-normal">Nom</th>
                <th className="text-right px-4 py-2 font-normal">Taille</th>
                <th className="text-left px-4 py-2 font-normal hidden md:table-cell">Modifié</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {/* Dossier parent */}
              {currentPath !== '/' && (
                <tr
                  className="border-b border-surface-700/50 hover:bg-surface-800 cursor-pointer"
                  onClick={() => {
                    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/'
                    navigate(parent)
                  }}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5 text-gray-400">
                      <Folder className="w-4 h-4 text-yellow-500/70 shrink-0" />
                      <span>..</span>
                    </div>
                  </td>
                  <td /><td /><td />
                </tr>
              )}

              {entries.map((entry) => {
                const fullPath = currentPath.replace(/\/$/, '') + '/' + entry.name
                const isRenaming = renameTarget === fullPath

                return (
                  <tr
                    key={entry.name}
                    className="border-b border-surface-700/50 hover:bg-surface-800 group"
                    onDoubleClick={() => entry.is_dir && navigate(fullPath)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        {entry.is_dir
                          ? <Folder className="w-4 h-4 text-yellow-400 shrink-0" />
                          : <File className="w-4 h-4 text-gray-500 shrink-0" />
                        }
                        {isRenaming ? (
                          <input
                            autoFocus
                            className="input py-0.5 px-1.5 text-sm h-7 w-48"
                            value={renameTo}
                            onChange={(e) => setRenameTo(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename()
                              if (e.key === 'Escape') setRenameTarget(null)
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        ) : (
                          <button
                            className="text-gray-200 hover:text-accent-400 text-left truncate"
                            onClick={() => entry.is_dir && navigate(fullPath)}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            {entry.name}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500 tabular-nums">
                      {entry.is_dir ? '—' : formatSize(entry.size)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-500 hidden md:table-cell">
                      {new Date(entry.mod_time).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 justify-end">
                        {!entry.is_dir && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownload(entry) }}
                            className="btn-ghost p-1"
                            title="Télécharger"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameTarget(fullPath)
                            setRenameTo(entry.name)
                          }}
                          className="btn-ghost p-1 text-xs px-2"
                          title="Renommer"
                        >
                          ✎
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(entry) }}
                          className="btn-ghost p-1 hover:text-danger"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal nouveau dossier */}
      {showMkdir && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card p-5 w-80">
            <h3 className="font-medium text-gray-100 mb-3">Nouveau dossier</h3>
            <input
              autoFocus
              className="input w-full mb-4"
              placeholder="Nom du dossier"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleMkdir(); if (e.key === 'Escape') setShowMkdir(false) }}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowMkdir(false)} className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={handleMkdir} className="btn-primary flex-1 justify-center">Créer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmation suppression */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="card p-5 w-80">
            <h3 className="font-medium text-gray-100 mb-2">Supprimer</h3>
            <p className="text-sm text-gray-400 mb-4 break-all">
              <strong className="text-gray-300">{deleteConfirm.split('/').pop()}</strong> sera supprimé définitivement.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(null)} className="btn-ghost flex-1 justify-center">Annuler</button>
              <button onClick={confirmDelete} className="btn-danger flex-1 justify-center">Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
