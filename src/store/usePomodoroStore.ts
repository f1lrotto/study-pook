import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type PomodoroMode = 'focus' | 'short_break' | 'long_break'
type PhaseNoticeKind = 'study_done' | 'break_done'

type PhaseNotice = {
  id: number
  kind: PhaseNoticeKind
  title: string
  body: string
}

const clampMinutes = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(180, Math.max(1, Math.round(value)))
}

const clampLongBreakEvery = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback
  }

  return Math.min(12, Math.max(2, Math.round(value)))
}

const modeDurationSeconds = (
  state: {
    focusMinutes: number
    shortBreakMinutes: number
    longBreakMinutes: number
  },
  mode: PomodoroMode,
) => {
  if (mode === 'focus') {
    return state.focusMinutes * 60
  }

  if (mode === 'short_break') {
    return state.shortBreakMinutes * 60
  }

  return state.longBreakMinutes * 60
}

const nextModeAfterCompletion = (
  mode: PomodoroMode,
  focusSessionsCompleted: number,
  longBreakEvery: number,
) => {
  if (mode !== 'focus') {
    return 'focus' as const
  }

  return focusSessionsCompleted % Math.max(2, longBreakEvery) === 0 ? 'long_break' : 'short_break'
}

type PomodoroStore = {
  focusMinutes: number
  shortBreakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  mode: PomodoroMode
  isRunning: boolean
  remainingSeconds: number
  phaseTotalSeconds: number
  sessionEndAt: number | null
  focusSessionsCompleted: number
  completionCount: number
  lastCompletedMode: PomodoroMode | null
  lastCompletedAt: number | null
  phaseNotice: PhaseNotice | null
  countedFocusSeconds: number
  pendingStudySeconds: number
  setDurations: (payload: {
    focusMinutes?: number
    shortBreakMinutes?: number
    longBreakMinutes?: number
    longBreakEvery?: number
  }) => void
  setMode: (mode: PomodoroMode) => void
  start: () => void
  pause: () => void
  resetCurrent: () => void
  skipPhase: () => void
  completeCurrentPhase: () => void
  dismissPhaseNotice: () => void
  consumePendingStudySeconds: () => number
  restorePendingStudySeconds: (seconds: number) => void
}

const initialFocusMinutes = 25
const initialShortBreakMinutes = 5
const initialLongBreakMinutes = 15
const initialLongBreakEvery = 4
const initialMode = 'focus' as const
const initialPhaseSeconds = initialFocusMinutes * 60

export const usePomodoroStore = create<PomodoroStore>()(
  persist(
    (set) => ({
      focusMinutes: initialFocusMinutes,
      shortBreakMinutes: initialShortBreakMinutes,
      longBreakMinutes: initialLongBreakMinutes,
      longBreakEvery: initialLongBreakEvery,
      mode: initialMode,
      isRunning: false,
      remainingSeconds: initialPhaseSeconds,
      phaseTotalSeconds: initialPhaseSeconds,
      sessionEndAt: null,
      focusSessionsCompleted: 0,
      completionCount: 0,
      lastCompletedMode: null,
      lastCompletedAt: null,
      phaseNotice: null,
      countedFocusSeconds: 0,
      pendingStudySeconds: 0,

      setDurations: (payload) =>
        set((state) => {
          const focusMinutes = clampMinutes(payload.focusMinutes ?? state.focusMinutes, 25)
          const shortBreakMinutes = clampMinutes(
            payload.shortBreakMinutes ?? state.shortBreakMinutes,
            5,
          )
          const longBreakMinutes = clampMinutes(
            payload.longBreakMinutes ?? state.longBreakMinutes,
            15,
          )
          const longBreakEvery = clampLongBreakEvery(
            payload.longBreakEvery ?? state.longBreakEvery,
            4,
          )

          const nextState = {
            ...state,
            focusMinutes,
            shortBreakMinutes,
            longBreakMinutes,
            longBreakEvery,
          }

          if (state.isRunning) {
            return nextState
          }

          const currentModeDuration = modeDurationSeconds(nextState, state.mode)
          return {
            ...nextState,
            remainingSeconds: currentModeDuration,
            phaseTotalSeconds: currentModeDuration,
          }
        }),

      setMode: (mode) =>
        set((state) => {
          const now = Date.now()
          let pendingStudySeconds = state.pendingStudySeconds

          if (state.mode === 'focus') {
            const remainingSeconds =
              state.isRunning && state.sessionEndAt
                ? Math.max(0, Math.ceil((state.sessionEndAt - now) / 1000))
                : state.remainingSeconds
            const elapsed = Math.max(0, state.phaseTotalSeconds - remainingSeconds)
            const delta = Math.max(0, elapsed - state.countedFocusSeconds)
            pendingStudySeconds += delta
          }

          const duration = modeDurationSeconds(state, mode)
          return {
            ...state,
            mode,
            isRunning: false,
            sessionEndAt: null,
            remainingSeconds: duration,
            phaseTotalSeconds: duration,
            countedFocusSeconds: 0,
            pendingStudySeconds,
          }
        }),

      start: () =>
        set((state) => {
          if (state.isRunning && state.sessionEndAt) {
            return state
          }

          const now = Date.now()
          const remainingSeconds = Math.max(1, state.remainingSeconds)
          return {
            ...state,
            isRunning: true,
            remainingSeconds,
            sessionEndAt: now + remainingSeconds * 1000,
          }
        }),

      pause: () =>
        set((state) => {
          if (!state.isRunning || !state.sessionEndAt) {
            return state
          }

          const now = Date.now()
          const remainingSeconds = Math.max(0, Math.ceil((state.sessionEndAt - now) / 1000))
          let pendingStudySeconds = state.pendingStudySeconds
          let countedFocusSeconds = state.countedFocusSeconds

          if (state.mode === 'focus') {
            const elapsed = Math.max(0, state.phaseTotalSeconds - remainingSeconds)
            const delta = Math.max(0, elapsed - state.countedFocusSeconds)
            pendingStudySeconds += delta
            countedFocusSeconds = elapsed
          }

          return {
            ...state,
            isRunning: false,
            sessionEndAt: null,
            remainingSeconds,
            pendingStudySeconds,
            countedFocusSeconds,
          }
        }),

      resetCurrent: () =>
        set((state) => {
          const now = Date.now()
          let pendingStudySeconds = state.pendingStudySeconds

          if (state.mode === 'focus') {
            const remainingSeconds =
              state.isRunning && state.sessionEndAt
                ? Math.max(0, Math.ceil((state.sessionEndAt - now) / 1000))
                : state.remainingSeconds

            const elapsed = Math.max(0, state.phaseTotalSeconds - remainingSeconds)
            const delta = Math.max(0, elapsed - state.countedFocusSeconds)
            pendingStudySeconds += delta
          }

          const duration = modeDurationSeconds(state, state.mode)
          return {
            ...state,
            isRunning: false,
            sessionEndAt: null,
            remainingSeconds: duration,
            phaseTotalSeconds: duration,
            countedFocusSeconds: 0,
            pendingStudySeconds,
          }
        }),

      skipPhase: () =>
        set((state) => {
          const now = Date.now()
          const wasRunning = state.isRunning
          let nextFocusSessionsCompleted = state.focusSessionsCompleted
          let pendingStudySeconds = state.pendingStudySeconds

          if (state.mode === 'focus') {
            const remainingSeconds =
              state.isRunning && state.sessionEndAt
                ? Math.max(0, Math.ceil((state.sessionEndAt - now) / 1000))
                : state.remainingSeconds

            const elapsed = Math.max(0, state.phaseTotalSeconds - remainingSeconds)
            const delta = Math.max(0, elapsed - state.countedFocusSeconds)
            pendingStudySeconds += delta
            nextFocusSessionsCompleted += 1
          }

          const mode = nextModeAfterCompletion(
            state.mode,
            nextFocusSessionsCompleted,
            state.longBreakEvery,
          )
          const duration = modeDurationSeconds(state, mode)

          return {
            ...state,
            mode,
            focusSessionsCompleted: nextFocusSessionsCompleted,
            remainingSeconds: duration,
            phaseTotalSeconds: duration,
            countedFocusSeconds: 0,
            pendingStudySeconds,
            isRunning: wasRunning,
            sessionEndAt: wasRunning ? now + duration * 1000 : null,
          }
        }),

      completeCurrentPhase: () =>
        set((state) => {
          if (!state.isRunning) {
            return state
          }

          const now = Date.now()
          let nextFocusSessionsCompleted = state.focusSessionsCompleted
          let pendingStudySeconds = state.pendingStudySeconds

          if (state.mode === 'focus') {
            const delta = Math.max(0, state.phaseTotalSeconds - state.countedFocusSeconds)
            pendingStudySeconds += delta
            nextFocusSessionsCompleted += 1
          }

          const mode = nextModeAfterCompletion(
            state.mode,
            nextFocusSessionsCompleted,
            state.longBreakEvery,
          )
          const duration = modeDurationSeconds(state, mode)
          const completionCount = state.completionCount + 1
          const phaseNotice: PhaseNotice =
            state.mode === 'focus'
              ? {
                  id: completionCount,
                  kind: 'study_done',
                  title: 'Blok štúdia dokončený',
                  body: 'Skvelá práca. Daj si krátku pauzu a potom pokračuj.',
                }
              : {
                  id: completionCount,
                  kind: 'break_done',
                  title: 'Pauza skončila',
                  body: 'Poď späť do flow. Daj si mini cieľ na ďalší blok.',
                }

          return {
            ...state,
            mode,
            focusSessionsCompleted: nextFocusSessionsCompleted,
            completionCount,
            lastCompletedMode: state.mode,
            lastCompletedAt: now,
            phaseNotice,
            remainingSeconds: duration,
            phaseTotalSeconds: duration,
            countedFocusSeconds: 0,
            pendingStudySeconds,
            isRunning: true,
            sessionEndAt: now + duration * 1000,
          }
        }),

      dismissPhaseNotice: () =>
        set((state) => ({
          ...state,
          phaseNotice: null,
        })),

      consumePendingStudySeconds: () => {
        let seconds = 0
        set((state) => {
          seconds = state.pendingStudySeconds
          return {
            ...state,
            pendingStudySeconds: 0,
          }
        })
        return seconds
      },

      restorePendingStudySeconds: (seconds) =>
        set((state) => ({
          ...state,
          pendingStudySeconds: state.pendingStudySeconds + Math.max(0, Math.floor(seconds)),
        })),
    }),
    {
      name: 'study-companion-pomodoro',
    },
  ),
)
