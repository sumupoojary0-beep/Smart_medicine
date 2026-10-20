/**
 * VoiceSearchModal — real voice search using the browser Web Speech API.
 * Works in Chrome / Edge (on localhost or HTTPS). No backend needed.
 *
 * Props: isOpen, onClose, onResult(text)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { normalizeTranscript } from '../../utils/voiceTranscript'
import { HiOutlineMicrophone, HiOutlineXMark, HiOutlineStopCircle } from 'react-icons/hi2'

const LANGUAGES = [
  { code: 'en-IN', label: 'English' },
  { code: 'hi-IN', label: 'हिन्दी' },
  { code: 'kn-IN', label: 'ಕನ್ನಡ' },
]

function getRecognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

const ERROR_TEXT = {
  'not-allowed': 'Microphone permission is blocked. Click the lock icon in the address bar, allow the microphone, then retry.',
  'service-not-allowed': 'Microphone permission is blocked. Allow it in the browser and retry.',
  'no-speech': "We didn't hear anything. Please try again and speak clearly.",
  'audio-capture': 'No microphone found. Connect a microphone and retry.',
  network: 'Speech service needs an internet connection. Check your network and retry.',
}

function VoiceSearchPanel({ onClose, onResult }) {
  const [phase, setPhase] = useState('idle') // idle | listening | done | error
  const [lang, setLang] = useState('en-IN')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const recRef = useRef(null)
  const supported = !!getRecognition()

  const stopRec = useCallback(() => {
    const r = recRef.current
    recRef.current = null
    if (r) {
      r.onresult = r.onerror = r.onend = null
      try { r.abort() } catch { /* ignore */ }
    }
  }, [])

  const start = useCallback(() => {
    const SR = getRecognition()
    if (!SR) return
    stopRec()
    setTranscript('')
    setError('')
    const rec = new SR()
    rec.lang = lang
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    let finalText = ''

    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript
      finalText = text
      setTranscript(text)
    }
    rec.onerror = (e) => {
      recRef.current = null
      setError(ERROR_TEXT[e.error] || 'Voice search failed. Please retry.')
      setPhase('error')
    }
    rec.onend = () => {
      if (recRef.current !== rec) return // already handled by error / stop
      recRef.current = null
      if (finalText.trim()) setPhase('done')
      else { setError(ERROR_TEXT['no-speech']); setPhase('error') }
    }
    recRef.current = rec
    try {
      rec.start()
      setPhase('listening')
    } catch {
      setError('Could not start the microphone. Please retry.')
      setPhase('error')
    }
  }, [lang, stopRec])

  // Stop the microphone when the panel unmounts (modal closed)
  useEffect(() => stopRec, [stopRec])

  function handleStop() {
    const r = recRef.current
    if (r) { try { r.stop() } catch { /* ignore */ } } // onend decides done / error
  }

  function handleUse() {
    const text = normalizeTranscript(transcript) || transcript.trim()
    if (text) onResult?.(text)
    onClose?.()
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="voice-modal-title"
      className="fixed inset-0 z-[400] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col items-center gap-5">
        <button type="button" onClick={onClose} aria-label="Close voice search"
          className="absolute top-4 right-4 flex items-center justify-center w-8 h-8 rounded-full text-slate-400 hover:bg-slate-100 transition-colors">
          <HiOutlineXMark size={18} aria-hidden="true" />
        </button>

        <div className="text-center">
          <h2 id="voice-modal-title" className="text-base font-bold text-slate-900 flex items-center gap-2 justify-center">
            <HiOutlineMicrophone size={18} className="text-primary-600" aria-hidden="true" />
            Voice Search
          </h2>
          <p className="text-xs text-slate-500 mt-1">Speak the medicine name</p>
        </div>

        {!supported ? (
          <p role="alert" className="text-sm text-center text-danger-700 bg-danger-50 rounded-xl px-4 py-3">
            Voice search isn&apos;t supported in this browser. Please use Google Chrome or Microsoft Edge, or type the medicine name.
          </p>
        ) : (
          <>
            {/* Language */}
            <div role="group" aria-label="Speech language" className="flex gap-1 bg-slate-100 rounded-xl p-1">
              {LANGUAGES.map((l) => (
                <button key={l.code} type="button" disabled={phase === 'listening'}
                  onClick={() => setLang(l.code)} aria-pressed={lang === l.code}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${
                    lang === l.code ? 'bg-white text-primary-700 shadow-sm' : 'text-slate-600'}`}>
                  {l.label}
                </button>
              ))}
            </div>

            {/* Mic */}
            <div className="relative flex items-center justify-center">
              {phase === 'listening' && (
                <>
                  <span className="absolute w-24 h-24 rounded-full bg-primary-100 animate-ping opacity-40" aria-hidden="true" />
                  <span className="absolute w-20 h-20 rounded-full bg-primary-100 animate-ping opacity-30" aria-hidden="true" />
                </>
              )}
              <div className={`flex items-center justify-center w-16 h-16 rounded-full transition-colors ${
                phase === 'listening' ? 'bg-primary-600' : phase === 'done' ? 'bg-success-600'
                  : phase === 'error' ? 'bg-danger-100' : 'bg-slate-100'}`}>
                <HiOutlineMicrophone size={28} aria-hidden="true"
                  className={phase === 'listening' || phase === 'done' ? 'text-white'
                    : phase === 'error' ? 'text-danger-600' : 'text-slate-400'} />
              </div>
            </div>

            {/* Status */}
            <div className="text-center min-h-[3.5rem] flex flex-col items-center justify-center w-full" aria-live="polite">
              {phase === 'idle' && <p className="text-sm text-slate-600">Press the button and start speaking</p>}
              {phase === 'listening' && (
                <>
                  <p className="text-sm font-semibold text-primary-700 animate-pulse">Listening…</p>
                  {transcript && <p className="text-sm text-slate-700 mt-1">{transcript}</p>}
                </>
              )}
              {phase === 'done' && (
                <>
                  <p className="text-xs text-slate-500 mb-1">Heard:</p>
                  <p className="text-base font-bold text-slate-900 bg-primary-50 px-4 py-1.5 rounded-lg" data-testid="voice-result">
                    {normalizeTranscript(transcript) || transcript}
                  </p>
                </>
              )}
              {phase === 'error' && <p role="alert" className="text-sm text-danger-700">{error}</p>}
            </div>

            <div className="flex gap-2 w-full">
              {phase === 'idle' && (
                <button type="button" onClick={start}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors">
                  <HiOutlineMicrophone size={16} aria-hidden="true" /> Start Listening
                </button>
              )}
              {phase === 'listening' && (
                <button type="button" onClick={handleStop}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-danger-600 text-white text-sm font-bold hover:bg-danger-700 transition-colors">
                  <HiOutlineStopCircle size={16} aria-hidden="true" /> Stop
                </button>
              )}
              {phase === 'done' && (
                <>
                  <button type="button" onClick={handleUse}
                    className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors">
                    Search This
                  </button>
                  <button type="button" onClick={start}
                    className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50">
                    Retry
                  </button>
                </>
              )}
              {phase === 'error' && (
                <button type="button" onClick={start}
                  className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors">
                  Try Again
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function VoiceSearchModal({ isOpen, onClose, onResult }) {
  if (!isOpen) return null // unmounting resets state and stops the mic
  return <VoiceSearchPanel onClose={onClose} onResult={onResult} />
}

export default VoiceSearchModal