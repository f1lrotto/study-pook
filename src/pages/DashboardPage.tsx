import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { LoadingState } from '../components/States'
import { formatConfidence, formatPercent } from '../lib/format'
import { useUserStore } from '../store/useUserStore'

export function DashboardPage() {
  const userKey = useUserStore((state) => state.userKey)
  const dashboard = useQuery(api.study.getDashboard, { userKey })

  if (dashboard === undefined) {
    return <LoadingState />
  }

  const courseRows = dashboard.courses as Array<{
    _id: string
    title: string
    completedCount: number
    themeCount: number
    averageConfidence: number
    completion: number
  }>

  const completionRatio =
    dashboard.themeCount > 0
      ? (dashboard.totals.reviewed + dashboard.totals.mastered) / dashboard.themeCount
      : 0

  return (
    <section className="stack-lg dashboard-page">
      <div className="grid-4">
        <article className="panel stat">
          <p>Témy spolu</p>
          <strong>{dashboard.themeCount}</strong>
        </article>

        <article className="panel stat">
          <p>Dokončenie</p>
          <strong>{formatPercent(completionRatio)}</strong>
        </article>

        <article className="panel stat">
          <p>Rozpracované</p>
          <strong>{dashboard.totals.inProgress}</strong>
        </article>

        <article className="panel stat">
          <p>Zvládnuté</p>
          <strong>{dashboard.totals.mastered}</strong>
        </article>
      </div>

      <article className="panel">
        <h2>Kurzy</h2>
        <div className="stack-sm">
          {courseRows.map((course) => {
            const averageConfidence = Math.round(course.averageConfidence)

            return (
              <div className="row-between compact" key={course._id}>
                <div className="stack-xs">
                  <h3>{course.title}</h3>
                  <div className="row-gap">
                    <span className="status-pill status-pill-course">
                      {course.completedCount}/{course.themeCount} prejdených
                    </span>
                    <span className="confidence-pill" data-level={averageConfidence}>
                      Confidence {formatConfidence(course.averageConfidence)}/5
                    </span>
                  </div>
                  <div aria-hidden className="meter">
                    <span style={{ width: `${Math.round(course.completion * 100)}%` }} />
                  </div>
                </div>
                <span className="badge badge-completion">{formatPercent(course.completion)}</span>
              </div>
            )
          })}
        </div>
      </article>
    </section>
  )
}
