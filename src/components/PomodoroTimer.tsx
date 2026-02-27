import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import { useMutation, useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { usePomodoroStore } from '../store/usePomodoroStore'
import { useUserStore } from '../store/useUserStore'

const modeLabels = {
  focus: 'Štúdium',
  short_break: 'Krátka pauza',
  long_break: 'Dlhá pauza',
} as const

type NoticeKind = 'study_done' | 'break_done'

const playPhaseDing = (context: AudioContext, kind: NoticeKind) => {
  const startAt = context.currentTime + 0.01

  const scheduleTone = (
    frequency: number,
    offset: number,
    duration: number,
    gain = 0.08,
    type: OscillatorType = 'sine',
  ) => {
    const oscillator = context.createOscillator()
    const gainNode = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, startAt + offset)
    gainNode.gain.setValueAtTime(0, startAt + offset)
    gainNode.gain.linearRampToValueAtTime(gain, startAt + offset + 0.01)
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + duration)

    oscillator.connect(gainNode)
    gainNode.connect(context.destination)

    oscillator.start(startAt + offset)
    oscillator.stop(startAt + offset + duration + 0.02)
  }

  if (kind === 'study_done') {
    scheduleTone(880, 0, 0.2, 0.09, 'triangle')
    scheduleTone(1046, 0.16, 0.24, 0.085, 'triangle')
    scheduleTone(1318, 0.34, 0.32, 0.08, 'sine')
  } else {
    scheduleTone(494, 0, 0.2, 0.075, 'sine')
    scheduleTone(740, 0.22, 0.26, 0.075, 'sine')
  }
}

const formatTimer = (seconds: number) => {
  const safe = Math.max(0, seconds)
  const minutes = Math.floor(safe / 60)
  const restSeconds = safe % 60
  return `${String(minutes).padStart(2, '0')}:${String(restSeconds).padStart(2, '0')}`
}

const formatStudyTotal = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const restSeconds = safe % 60

  if (hours) {
    return restSeconds ? `${hours}h ${minutes}m ${restSeconds}s` : `${hours}h ${minutes}m`
  }

  if (minutes) {
    return restSeconds ? `${minutes}m ${restSeconds}s` : `${minutes}m`
  }

  return `${restSeconds}s`
}

export function PomodoroTimer() {
  const userKey = useUserStore((state) => state.userKey)

  const mode = usePomodoroStore((state) => state.mode)
  const isRunning = usePomodoroStore((state) => state.isRunning)
  const remainingSeconds = usePomodoroStore((state) => state.remainingSeconds)
  const sessionEndAt = usePomodoroStore((state) => state.sessionEndAt)
  const phaseTotalSeconds = usePomodoroStore((state) => state.phaseTotalSeconds)
  const countedFocusSeconds = usePomodoroStore((state) => state.countedFocusSeconds)
  const focusMinutes = usePomodoroStore((state) => state.focusMinutes)
  const shortBreakMinutes = usePomodoroStore((state) => state.shortBreakMinutes)
  const longBreakMinutes = usePomodoroStore((state) => state.longBreakMinutes)
  const longBreakEvery = usePomodoroStore((state) => state.longBreakEvery)
  const focusSessionsCompleted = usePomodoroStore((state) => state.focusSessionsCompleted)
  const phaseNotice = usePomodoroStore((state) => state.phaseNotice)
  const pendingStudySeconds = usePomodoroStore((state) => state.pendingStudySeconds)

  const start = usePomodoroStore((state) => state.start)
  const pause = usePomodoroStore((state) => state.pause)
  const resetCurrent = usePomodoroStore((state) => state.resetCurrent)
  const skipPhase = usePomodoroStore((state) => state.skipPhase)
  const setMode = usePomodoroStore((state) => state.setMode)
  const setDurations = usePomodoroStore((state) => state.setDurations)
  const completeCurrentPhase = usePomodoroStore((state) => state.completeCurrentPhase)
  const dismissPhaseNotice = usePomodoroStore((state) => state.dismissPhaseNotice)
  const consumePendingStudySeconds = usePomodoroStore((state) => state.consumePendingStudySeconds)
  const restorePendingStudySeconds = usePomodoroStore((state) => state.restorePendingStudySeconds)

  const addStudySeconds = useMutation(api.study.addStudySeconds)
  const studyTotal = useQuery(api.study.getStudyTotal, { userKey })

  const [now, setNow] = useState(() => Date.now())
  const isSyncingRef = useRef(false)
  const lastPlayedNoticeIdRef = useRef<number | null>(phaseNotice?.id ?? null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const ensureAudioContext = useCallback(async () => {
    if (typeof window === 'undefined') {
      return null
    }

    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

    if (!Context) {
      return null
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new Context()
    }

    if (audioContextRef.current.state === 'suspended') {
      try {
        await audioContextRef.current.resume()
      } catch {
        return null
      }
    }

    return audioContextRef.current
  }, [])

  useEffect(() => {
    if (!isRunning) {
      return
    }

    const interval = window.setInterval(() => {
      setNow(Date.now())
    }, 250)

    return () => {
      window.clearInterval(interval)
    }
  }, [isRunning])

  useEffect(() => {
    const unlockAudio = () => {
      void ensureAudioContext()
    }

    window.addEventListener('pointerdown', unlockAudio, { once: true })
    window.addEventListener('keydown', unlockAudio, { once: true })

    return () => {
      window.removeEventListener('pointerdown', unlockAudio)
      window.removeEventListener('keydown', unlockAudio)
    }
  }, [ensureAudioContext])

  useEffect(() => {
    if (!isRunning || !sessionEndAt) {
      return
    }

    if (sessionEndAt <= now) {
      completeCurrentPhase()
    }
  }, [completeCurrentPhase, isRunning, now, sessionEndAt])

  useEffect(() => {
    if (!phaseNotice || phaseNotice.id === lastPlayedNoticeIdRef.current) {
      return
    }

    lastPlayedNoticeIdRef.current = phaseNotice.id
    void ensureAudioContext().then((context) => {
      if (!context) {
        return
      }

      playPhaseDing(context, phaseNotice.kind)
    })
  }, [ensureAudioContext, phaseNotice])

  useEffect(() => {
    if (!phaseNotice) {
      return
    }

    const timeout = window.setTimeout(() => dismissPhaseNotice(), 7000)
    return () => window.clearTimeout(timeout)
  }, [dismissPhaseNotice, phaseNotice])

  useEffect(() => {
    if (!pendingStudySeconds || isSyncingRef.current) {
      return
    }

    const chunk = consumePendingStudySeconds()
    if (!chunk) {
      return
    }

    isSyncingRef.current = true
    void addStudySeconds({
      userKey,
      seconds: chunk,
    })
      .catch(() => {
        restorePendingStudySeconds(chunk)
      })
      .finally(() => {
        isSyncingRef.current = false
      })
  }, [
    addStudySeconds,
    consumePendingStudySeconds,
    pendingStudySeconds,
    restorePendingStudySeconds,
    userKey,
  ])

  const displaySeconds = useMemo(() => {
    if (!isRunning || !sessionEndAt) {
      return Math.max(0, remainingSeconds)
    }

    return Math.max(0, Math.ceil((sessionEndAt - now) / 1000))
  }, [isRunning, now, remainingSeconds, sessionEndAt])

  const liveFocusSeconds = useMemo(() => {
    if (!isRunning || mode !== 'focus') {
      return 0
    }

    const elapsed = Math.max(0, phaseTotalSeconds - displaySeconds)
    return Math.max(0, elapsed - countedFocusSeconds)
  }, [countedFocusSeconds, displaySeconds, isRunning, mode, phaseTotalSeconds])

  const totalWithPending =
    (studyTotal?.totalStudySeconds ?? 0) + pendingStudySeconds + liveFocusSeconds
  const cycleProgress = (focusSessionsCompleted % Math.max(2, longBreakEvery)) + 1
  const activeBurstId = phaseNotice?.kind === 'study_done' ? phaseNotice.id : 0
  const confettiPieces = Array.from({ length: 18 }, (_, index) => {
    const angle = Math.round((360 / 18) * index + (index % 3) * 7)
    const distance = 24 + (index % 6) * 10
    const radians = (angle * Math.PI) / 180
    const x = Number((Math.cos(radians) * distance).toFixed(2))
    const y = Number((Math.sin(radians) * distance).toFixed(2))
    const delay = Number((index % 5) * 0.03).toFixed(2)
    const duration = Number(0.75 + (index % 4) * 0.11).toFixed(2)
    const style = {
      '--angle': `${angle}deg`,
      '--x': `${x}px`,
      '--y': `${y}px`,
      '--delay': `${delay}s`,
      '--duration': `${duration}s`,
      '--hue': `${(index * 19) % 360}`,
    } as CSSProperties

    return { key: `${activeBurstId || 'idle'}-${index}`, style }
  })

  return (
    <article className="pomodoro-widget" data-mode={mode}>
      {phaseNotice ? (
        <aside className="pomodoro-notice" data-kind={phaseNotice.kind} role="status">
          <p className="pomodoro-notice-title">{phaseNotice.title}</p>
          <p>{phaseNotice.body}</p>
          <button className="chip" onClick={() => dismissPhaseNotice()} type="button">
            Zavrieť
          </button>
        </aside>
      ) : null}
      {activeBurstId ? (
        <div className="pomodoro-confetti" key={activeBurstId}>
          {confettiPieces.map((piece) => (
            <span className="pomodoro-confetti-piece" key={piece.key} style={piece.style} />
          ))}
        </div>
      ) : null}
      <div className="pomodoro-main-row">
        <p className="pomodoro-mode">{modeLabels[mode]}</p>
        <p className="pomodoro-time">{formatTimer(displaySeconds)}</p>
        <p className="pomodoro-total">Spolu: {formatStudyTotal(totalWithPending)}</p>

        <div className="pomodoro-controls">
          <button onClick={isRunning ? pause : start} type="button">
            {isRunning ? 'Pauza' : 'Štart'}
          </button>
          <button className="chip" onClick={resetCurrent} type="button">
            Reset
          </button>
          <details className="pomodoro-menu">
            <summary>Nastaviť</summary>

            <div className="pomodoro-menu-panel stack-sm">
              <div className="pomodoro-mode-tabs">
                <button
                  className={`chip ${mode === 'focus' ? 'chip-active' : ''}`}
                  onClick={() => setMode('focus')}
                  type="button"
                >
                  Štúdium
                </button>
                <button
                  className={`chip ${mode === 'short_break' ? 'chip-active' : ''}`}
                  onClick={() => setMode('short_break')}
                  type="button"
                >
                  Krátka
                </button>
                <button
                  className={`chip ${mode === 'long_break' ? 'chip-active' : ''}`}
                  onClick={() => setMode('long_break')}
                  type="button"
                >
                  Dlhá
                </button>
              </div>

              <div className="pomodoro-menu-actions">
                <button className="chip" onClick={skipPhase} type="button">
                  Preskočiť fázu
                </button>
              </div>

              <div className="pomodoro-settings-grid">
                <label className="stack-xs">
                  <span>Štúdium (min)</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setDurations({
                        focusMinutes: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={focusMinutes}
                  />
                </label>

                <label className="stack-xs">
                  <span>Krátka pauza</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setDurations({
                        shortBreakMinutes: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={shortBreakMinutes}
                  />
                </label>

                <label className="stack-xs">
                  <span>Dlhá pauza</span>
                  <input
                    min={1}
                    onChange={(event) =>
                      setDurations({
                        longBreakMinutes: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={longBreakMinutes}
                  />
                </label>

                <label className="stack-xs">
                  <span>Dlhá po N cykloch</span>
                  <input
                    min={2}
                    onChange={(event) =>
                      setDurations({
                        longBreakEvery: Number(event.target.value),
                      })
                    }
                    type="number"
                    value={longBreakEvery}
                  />
                </label>
              </div>

              <p className="pomodoro-cycle">
                Cyklus: {cycleProgress}/{Math.max(2, longBreakEvery)}
              </p>
            </div>
          </details>
        </div>
      </div>
    </article>
  )
}
