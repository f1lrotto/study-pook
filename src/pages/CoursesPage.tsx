import { useMemo, useState } from 'react'

import { useQuery } from 'convex/react'
import { Link } from 'react-router-dom'

import { api } from '../../convex/_generated/api'
import { EmptyState, LoadingState } from '../components/States'
import { formatConfidence, formatPercent } from '../lib/format'
import { progressStatusLabels } from '../lib/statuses'
import { useUserStore } from '../store/useUserStore'

export function CoursesPage() {
  const [search, setSearch] = useState('')
  const userKey = useUserStore((state) => state.userKey)

  const courses = useQuery(api.study.listCourses, { userKey })
  const themes = useQuery(api.study.listThemes, {
    userKey,
    search: search.trim() || undefined,
  })

  const courseRows = (courses ?? []) as Array<{
    _id: string
    title: string
    completedCount: number
    themeCount: number
    completion: number
    averageConfidence: number
  }>

  const groupedThemes = useMemo(() => {
    const themeRows = (themes ?? []) as Array<{
      _id: string
      courseId: string
      number: number
      title: string
      hasStudyNotes: boolean
      hasUserEditedNotes: boolean
      progress: { status: keyof typeof progressStatusLabels; confidence: number } | null
    }>

    if (!themeRows.length) {
      return new Map<string, typeof themeRows>()
    }

    return themeRows.reduce((acc, theme) => {
      const next = acc.get(theme.courseId) ?? []
      next.push(theme)
      acc.set(theme.courseId, next)
      return acc
    }, new Map<string, typeof themeRows>())
  }, [themes])

  if (!courses) {
    return <LoadingState />
  }

  return (
    <section className="stack-lg courses-page">
      <article className="panel">
        <h2>Prehľad tém</h2>
        <label className="stack-xs" htmlFor="theme-search">
          <span>Filtrovať podľa názvu</span>
          <input
            id="theme-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="napr. Fourier, SQL, derivácia"
            type="search"
            value={search}
          />
        </label>
      </article>

      {courseRows.map((course) => {
        const courseThemes = groupedThemes.get(course._id) ?? []
        const missingNotesCount = courseThemes.filter((theme) => !theme.hasStudyNotes).length
        const editedNotesCount = courseThemes.filter((theme) => theme.hasUserEditedNotes).length

        return (
          <article className="panel" key={course._id}>
            <div className="row-between compact course-section-header">
              <div>
                <div className="inline-title-row">
                  <h2 className="course-title">{course.title}</h2>
                </div>
                <p>{courseThemes.length} tém zobrazených</p>
                <div className="course-meta-row">
                  <span className="status-pill status-pill-course">
                    {course.completedCount}/{course.themeCount} prejdených
                  </span>
                  {missingNotesCount ? (
                    <span className="notes-missing-pill">{missingNotesCount} bez poznámok</span>
                  ) : null}
                  {editedNotesCount ? (
                    <span className="notes-edited-pill">
                      {editedNotesCount} s vlastnými úpravami
                    </span>
                  ) : null}
                  <span
                    className="confidence-pill"
                    data-level={Math.round(course.averageConfidence)}
                  >
                    Confidence {formatConfidence(course.averageConfidence)}/5
                  </span>
                  <span className="badge badge-completion">{formatPercent(course.completion)}</span>
                </div>
                <div aria-hidden className="meter">
                  <span style={{ width: `${Math.round(course.completion * 100)}%` }} />
                </div>
              </div>
            </div>

            {courseThemes.length === 0 ? (
              <EmptyState message="Žiadna téma pre aktuálny filter." />
            ) : (
              <ul className="stack-sm">
                {courseThemes.map((theme) => {
                  const themeStatus = theme.progress?.status ?? 'not_started'
                  const themeConfidence = theme.progress?.confidence ?? 0

                  return (
                    <li className="row-between compact" key={theme._id}>
                      <div>
                        <div className="inline-title-row">
                          <Link className="strong-link" to={`/theme/${theme._id}`}>
                            {theme.number}. {theme.title}
                          </Link>
                        </div>
                        <div className="row-gap theme-meta-row">
                          <span className="status-pill" data-status={themeStatus}>
                            {progressStatusLabels[themeStatus]}
                          </span>
                          {!theme.hasStudyNotes ? (
                            <span className="notes-missing-pill">Bez poznámok</span>
                          ) : null}
                          {theme.hasUserEditedNotes ? (
                            <span className="notes-edited-pill">Vlastné úpravy</span>
                          ) : null}
                          <span
                            className="confidence-pill"
                            data-level={themeConfidence}
                            data-status={themeStatus}
                          >
                            Confidence {themeConfidence}/5
                          </span>
                        </div>
                      </div>
                      <Link className="button" to={`/theme/${theme._id}`}>
                        Študovať
                      </Link>
                    </li>
                  )
                })}
              </ul>
            )}
          </article>
        )
      })}
    </section>
  )
}
