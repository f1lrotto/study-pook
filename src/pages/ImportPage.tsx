import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { hasConfiguredConvexUrl } from '../lib/convexClient'

export function ImportPage() {
  const runs = useQuery(api.study.listImportRuns, {})

  return (
    <section className="stack-lg">
      <article className="panel">
        <h2>Import dát</h2>
        <p>
          Použi CLI skript na import PDF/DOCX do Convex databázy. Surové súbory ostávajú v{' '}
          <code>raw/</code>.
        </p>

        <pre className="command-block">bun run import:data</pre>

        {!hasConfiguredConvexUrl ? (
          <p className="warning">
            Chýba <code>VITE_CONVEX_URL</code>. Nastav URL z <code>convex dev</code> alebo z
            nasadenia.
          </p>
        ) : null}
      </article>

      <article className="panel">
        <h3>Posledné importy</h3>
        {!runs?.length ? (
          <p>Žiadny import zatiaľ nebežal.</p>
        ) : (
          <ul className="stack-sm">
            {runs.map((run) => (
              <li className="row-between compact" key={run._id}>
                <div>
                  <strong>{run.importKey}</strong>
                  <p>
                    Stav: {run.status} • {new Date(run.startedAt).toLocaleString()}
                  </p>
                </div>
                {run.parsedStats ? <pre>{JSON.stringify(run.parsedStats, null, 2)}</pre> : null}
              </li>
            ))}
          </ul>
        )}
      </article>
    </section>
  )
}
