import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Terminal as TerminalIcon } from 'lucide-react'
import TerminalComponent from '../components/Terminal/Terminal'

export default function TerminalPage() {
  const { hostId } = useParams<{ hostId: string }>()
  const navigate = useNavigate()

  if (!hostId) {
    navigate('/')
    return null
  }

  return (
    <div className="h-screen flex flex-col bg-surface-900">
      {/* Navigation */}
      <nav className="flex items-center gap-3 px-4 py-2 bg-surface-800 border-b border-surface-700">
        <button
          onClick={() => navigate('/')}
          className="btn-ghost py-1 px-2 text-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </button>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <TerminalIcon className="w-3.5 h-3.5" />
          <span>Terminal SSH</span>
        </div>
      </nav>

      {/* Terminal plein écran */}
      <div className="flex-1 overflow-hidden">
        <TerminalComponent hostId={hostId} />
      </div>
    </div>
  )
}
