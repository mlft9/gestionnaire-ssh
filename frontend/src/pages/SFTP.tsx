import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, HardDrive } from 'lucide-react'
import SFTPBrowser from '../components/SFTP/SFTPBrowser'

export default function SFTPPage() {
  const { hostId } = useParams<{ hostId: string }>()
  const navigate = useNavigate()

  if (!hostId) {
    navigate('/')
    return null
  }

  return (
    <div className="h-screen flex flex-col bg-surface-900">
      <nav className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-b border-surface-700 shrink-0">
        <button
          onClick={() => navigate('/')}
          className="btn-ghost py-1 px-2 text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </button>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <HardDrive className="w-3.5 h-3.5" />
          <span>Navigateur SFTP</span>
        </div>
      </nav>

      <div className="flex-1 overflow-hidden">
        <SFTPBrowser hostId={hostId} />
      </div>
    </div>
  )
}
