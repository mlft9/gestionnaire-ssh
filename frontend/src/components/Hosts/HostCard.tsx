import { useState } from 'react'
import { Server, Pencil, Trash2, Terminal, Key, Lock, Copy, Check, HardDrive } from 'lucide-react'
import { Host } from '../../services/api'

interface Props {
  host: Host
  onConnect: (host: Host) => void
  onSFTP: (host: Host) => void
  onEdit: (host: Host) => void
  onDelete: (host: Host) => void
}

export default function HostCard({ host, onConnect, onSFTP, onEdit, onDelete }: Props) {
  const [copied, setCopied] = useState(false)

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    const text = `${host.username}@${host.hostname}:${host.port}`
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="card p-4 hover:border-surface-500 transition-colors group">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2 bg-surface-700 rounded-md shrink-0 text-lg leading-none flex items-center justify-center w-9 h-9">
            {host.icon ? (
              <span>{host.icon}</span>
            ) : (
              <Server className="w-4 h-4 text-accent-400" />
            )}
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-gray-100 truncate">{host.name}</h3>
            <div className="flex items-center gap-1 group/copy">
              <p className="text-xs text-gray-500 truncate">
                {host.username}@{host.hostname}:{host.port}
              </p>
              <button
                onClick={handleCopy}
                className="opacity-0 group-hover/copy:opacity-100 transition-opacity p-0.5 text-gray-600 hover:text-gray-300"
                title="Copier l'adresse"
              >
                {copied
                  ? <Check className="w-3 h-3 text-success" />
                  : <Copy className="w-3 h-3" />
                }
              </button>
            </div>
          </div>
        </div>

        {/* Badge auth type */}
        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs shrink-0 ${
          host.auth_type === 'key'
            ? 'bg-warning/10 text-warning border border-warning/20'
            : 'bg-surface-700 text-gray-500 border border-surface-600'
        }`}>
          {host.auth_type === 'key' ? (
            <Key className="w-3 h-3" />
          ) : (
            <Lock className="w-3 h-3" />
          )}
          {host.auth_type === 'key' ? 'SSH Key' : 'Password'}
        </div>
      </div>

      {/* Tags */}
      {host.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2.5">
          {host.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 bg-accent-500/10 text-accent-400 border border-accent-500/20 rounded text-xs"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={() => onConnect(host)}
          className="btn-primary flex-1 justify-center text-xs py-1.5"
        >
          <Terminal className="w-3.5 h-3.5" />
          Terminal
        </button>
        <button
          onClick={() => onSFTP(host)}
          className="btn-ghost flex-1 justify-center text-xs py-1.5"
          title="Navigateur SFTP"
        >
          <HardDrive className="w-3.5 h-3.5" />
          SFTP
        </button>
        <button
          onClick={() => onEdit(host)}
          className="btn-ghost p-1.5"
          title="Modifier"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDelete(host)}
          className="btn-ghost p-1.5 hover:text-danger"
          title="Supprimer"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
