import { useMemo, useState } from 'react'

import { useMutation, useQuery } from 'convex/react'
import { Link } from 'react-router-dom'

import { api } from '../../convex/_generated/api'
import { LoadingState } from '../components/States'
import { progressStatuses, progressStatusLabels } from '../lib/statuses'
import { useUserStore } from '../store/useUserStore'

export function WheelPage() {
  const userKey = useUserStore((state) => state.userKey)
  const courses = useQuery(api.study.listCourses, { userKey })

  const spinTheme = useMutation(api.study.spinTheme)
  const setThemeProgress = useMutation(api.study.setThemeProgress)

  const [selectedCourseId, setSelectedCourseId] = useState<string | 'all'>('all')
  const [selectedStatuses, setSelectedStatuses] = useState<(typeof progressStatuses)[number][]>([
    'not_started',
    'in_progress',
    'reviewed',
    'mastered',
  ])
  const [maxConfidence, setMaxConfidence] = useState(5)
  const [isSpinning, setIsSpinning] = useState(false)
  const [rotation, setRotation] = useState(0)
  const [result, setResult] = useState<Awaited<ReturnType<typeof spinTheme>> | null>(null)

  const disabled = isSpinning || selectedStatuses.length === 0

  const statusLabel = useMemo(
    () => selectedStatuses.map((status) => progressStatusLabels[status]).join(', '),
    [selectedStatuses],
  )

  if (!courses) {
    return <LoadingState />
  }

  const toggleStatus = (status: (typeof progressStatuses)[number]) => {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
    )
  }

  const spin = async () => {
    setIsSpinning(true)
    setRotation((prev) => prev + 1260 + Math.floor(Math.random() * 360))

    try {
      const response = await spinTheme({
        userKey,
        courseId: selectedCourseId === 'all' ? undefined : (selectedCourseId as never),
        statuses: selectedStatuses,
        maxConfidence,
      })

      setResult(response)
    } finally {
      setTimeout(() => setIsSpinning(false), 900)
    }
  }

  return (
    <section className="stack-lg">
      <article className="panel">
        <h2>Smart wheel</h2>
        <p>
          Výber je vážený podľa confidence, stavu a čerstvosti. Aktívne stavy:{' '}
          <strong>{statusLabel}</strong>
        </p>

        <div className="grid-3">
          <label className="stack-xs" htmlFor="course-select">
            <span>Kurz</span>
            <select
              id="course-select"
              onChange={(event) => setSelectedCourseId(event.target.value as never)}
              value={selectedCourseId}
            >
              <option value="all">Všetky kurzy</option>
              {courses.map((course) => (
                <option key={course._id} value={course._id}>
                  {course.title}
                </option>
              ))}
            </select>
          </label>

          <label className="stack-xs" htmlFor="max-confidence">
            <span>Max confidence: {maxConfidence}</span>
            <input
              id="max-confidence"
              max={5}
              min={0}
              onChange={(event) => setMaxConfidence(Number(event.target.value))}
              step={1}
              type="range"
              value={maxConfidence}
            />
          </label>

          <div className="stack-xs">
            <span>Stavy</span>
            <div className="chip-wrap">
              {progressStatuses.map((status) => {
                const active = selectedStatuses.includes(status)

                return (
                  <button
                    className={`chip ${active ? 'chip-active' : ''}`}
                    key={status}
                    onClick={() => toggleStatus(status)}
                    type="button"
                  >
                    {progressStatusLabels[status]}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </article>

      <article className="panel wheel-panel">
        <div className="wheel-pointer" />
        <div className="wheel-disc" style={{ transform: `rotate(${rotation}deg)` }} />
        <button disabled={disabled} onClick={spin} type="button">
          {isSpinning ? 'Točí sa…' : 'Roztočiť'}
        </button>
      </article>

      {result ? (
        <article className="panel">
          <h3>Vybraná téma</h3>
          <p className="kicker">{result.course?.title}</p>
          <h2>{result.theme.title}</h2>
          <div className="row-gap theme-meta-row">
            <span className="status-pill" data-status={result.progress?.status ?? 'not_started'}>
              {result.progress ? progressStatusLabels[result.progress.status] : 'Nezačaté'}
            </span>
            <span
              className="confidence-pill"
              data-level={result.progress?.confidence ?? 0}
              data-status={result.progress?.status ?? 'not_started'}
            >
              Confidence: {result.progress?.confidence ?? 0}/5
            </span>
          </div>

          <div className="row-gap">
            <Link className="button" to={`/theme/${result.theme._id}`}>
              Otvoriť tému
            </Link>
            <button
              onClick={() =>
                setThemeProgress({
                  userKey,
                  themeId: result.theme._id,
                  status: 'in_progress',
                  confidence: Math.max(result.progress?.confidence ?? 0, 1),
                })
              }
              type="button"
            >
              Označiť ako rozpracované
            </button>
          </div>
        </article>
      ) : null}
    </section>
  )
}
