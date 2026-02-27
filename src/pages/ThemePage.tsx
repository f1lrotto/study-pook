import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import { useMutation, useQuery } from 'convex/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link, useParams } from 'react-router-dom'

import { api } from '../../convex/_generated/api'
import { RichTextEditor } from '../components/RichTextEditor'
import { EmptyState, LoadingState } from '../components/States'
import {
  parseThemeNoteFile,
  resolveMarkdownImageSrc,
  serializeThemeNoteFile,
} from '../lib/notes/markdownFile'
import { progressStatuses, progressStatusLabels } from '../lib/statuses'
import { useUserStore } from '../store/useUserStore'

type ConfidenceMode = 'derived' | 'manual'
const clampConfidence = (value: number) => Math.max(0, Math.min(5, Math.round(value)))

export function ThemePage() {
  const { themeId } = useParams<{ themeId: string }>()
  const userKey = useUserStore((state) => state.userKey)

  const data = useQuery(
    api.study.getTheme,
    themeId
      ? {
          themeId: themeId as never,
          userKey,
        }
      : 'skip',
  )

  const courseThemes = useQuery(
    api.study.listThemes,
    data
      ? {
          courseId: data.theme.courseId as never,
          userKey,
        }
      : 'skip',
  )

  const saveProgress = useMutation(api.study.setThemeProgress)
  const updateThemeTitle = useMutation(api.study.updateThemeTitle)
  const updateThemeSubthemes = useMutation(api.study.updateThemeSubthemes)
  const saveThemeNoteMarkdown = useMutation(api.study.saveThemeNoteMarkdown)
  const importThemeNoteMarkdown = useMutation(api.study.importThemeNoteMarkdown)

  const [status, setStatus] = useState<(typeof progressStatuses)[number]>('not_started')
  const [confidenceMode, setConfidenceMode] = useState<ConfidenceMode>('manual')
  const [manualConfidence, setManualConfidence] = useState(0)
  const [subthemeConfidences, setSubthemeConfidences] = useState<number[]>([])
  const [isSaving, setIsSaving] = useState(false)

  const [isEditingThemeTitle, setIsEditingThemeTitle] = useState(false)
  const [themeTitleDraft, setThemeTitleDraft] = useState('')
  const [isSavingThemeTitle, setIsSavingThemeTitle] = useState(false)

  const [isEditingSubthemes, setIsEditingSubthemes] = useState(false)
  const [subthemesDraft, setSubthemesDraft] = useState('')
  const [isSavingSubthemes, setIsSavingSubthemes] = useState(false)

  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const [isSavingNotes, setIsSavingNotes] = useState(false)
  const [isImportingNotes, setIsImportingNotes] = useState(false)
  const [noteError, setNoteError] = useState<string | null>(null)

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  const noteImportInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!data) {
      setStatus('not_started')
      setConfidenceMode('manual')
      setManualConfidence(0)
      setSubthemeConfidences([])
      return
    }

    setStatus(data.progress?.status ?? 'not_started')

    const nextManualConfidence = data.progress?.manualConfidence ?? data.progress?.confidence ?? 0
    setManualConfidence(clampConfidence(nextManualConfidence))

    const nextMode =
      data.progress?.confidenceMode ?? (data.theme.subthemes.length ? 'derived' : 'manual')
    setConfidenceMode(nextMode === 'derived' && data.theme.subthemes.length ? 'derived' : 'manual')

    const baseConfidences = data.progress?.subthemeConfidences ?? []
    setSubthemeConfidences(
      Array.from({ length: data.theme.subthemes.length }, (_, index) =>
        clampConfidence(baseConfidences[index] ?? 0),
      ),
    )
  }, [data])

  useEffect(() => {
    if (!data) {
      return
    }

    if (!isEditingThemeTitle) {
      setThemeTitleDraft(data.theme.title)
    }

    if (!isEditingSubthemes) {
      setSubthemesDraft(data.theme.subthemes.join('\n'))
    }

    if (!isEditingNotes) {
      setNoteDraft(data.themeNote.markdown)
    }
  }, [data, isEditingNotes, isEditingSubthemes, isEditingThemeTitle])

  if (!themeId) {
    return <EmptyState message="Chýba identifikátor témy." />
  }

  if (data === undefined) {
    return <LoadingState />
  }

  if (!data) {
    return <EmptyState message="Téma sa nenašla." />
  }

  const normalizedSubthemeConfidences = Array.from(
    { length: data.theme.subthemes.length },
    (_, index) => clampConfidence(subthemeConfidences[index] ?? 0),
  )

  const derivedConfidence = data.theme.subthemes.length
    ? clampConfidence(
        normalizedSubthemeConfidences.reduce((sum, value) => sum + value, 0) /
          data.theme.subthemes.length,
      )
    : clampConfidence(manualConfidence)

  const effectiveConfidence =
    confidenceMode === 'manual' || !data.theme.subthemes.length
      ? clampConfidence(manualConfidence)
      : derivedConfidence

  const onSaveProgress = async () => {
    setIsSaving(true)

    try {
      await saveProgress({
        userKey,
        themeId: data.theme._id,
        status,
        confidence: effectiveConfidence,
        confidenceMode,
        manualConfidence: clampConfidence(manualConfidence),
        subthemeConfidences: normalizedSubthemeConfidences,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const saveThemeTitle = async () => {
    setIsSavingThemeTitle(true)

    try {
      await updateThemeTitle({
        themeId: data.theme._id,
        title: themeTitleDraft,
      })
      setIsEditingThemeTitle(false)
    } finally {
      setIsSavingThemeTitle(false)
    }
  }

  const saveSubthemes = async () => {
    setIsSavingSubthemes(true)

    try {
      const subthemes = subthemesDraft
        .split('\n')
        .map((line) => line.trim().replace(/\s+/g, ' '))
        .filter(Boolean)

      await updateThemeSubthemes({
        themeId: data.theme._id,
        subthemes,
      })
      setIsEditingSubthemes(false)
    } finally {
      setIsSavingSubthemes(false)
    }
  }

  const startNotesEdit = () => {
    setNoteError(null)
    setNoteDraft(data.themeNote.markdown)
    setIsEditingNotes(true)
  }

  const cancelNotesEdit = () => {
    setNoteError(null)
    setIsEditingNotes(false)
    setNoteDraft(data.themeNote.markdown)
  }

  const saveNotes = async () => {
    setIsSavingNotes(true)
    setNoteError(null)

    try {
      await saveThemeNoteMarkdown({
        themeId: data.theme._id,
        markdown: noteDraft,
      })
      setIsEditingNotes(false)
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'Poznámky sa nepodarilo uložiť.')
    } finally {
      setIsSavingNotes(false)
    }
  }

  const exportNotes = () => {
    const payload = serializeThemeNoteFile({
      themeSlug: data.theme.slug,
      themeTitle: data.theme.title,
      markdown: data.themeNote.markdown,
    })

    const blob = new Blob([payload], {
      type: 'text/markdown;charset=utf-8',
    })

    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${data.theme.slug}.md`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const triggerImportNotes = () => {
    setNoteError(null)
    noteImportInputRef.current?.click()
  }

  const importNotesFile = async (file: File) => {
    const fileText = await file.text()
    const parsedFile = parseThemeNoteFile(fileText)

    if (parsedFile.frontmatter.themeSlug !== data.theme.slug) {
      throw new Error(
        `Súbor patrí k téme ${parsedFile.frontmatter.themeSlug}, ale otvorená je ${data.theme.slug}.`,
      )
    }

    await importThemeNoteMarkdown({
      themeId: data.theme._id,
      expectedThemeSlug: parsedFile.frontmatter.themeSlug,
      markdown: parsedFile.markdown,
    })
  }

  const onImportInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    setIsImportingNotes(true)
    setNoteError(null)

    try {
      await importNotesFile(file)
      setIsEditingNotes(false)
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : 'Import poznámky zlyhal.')
    } finally {
      setIsImportingNotes(false)
    }
  }

  const subthemeRows = data.theme.subthemes.reduce(
    (result, value) => {
      const occurrence = (result.counts.get(value) ?? 0) + 1
      result.counts.set(value, occurrence)
      result.rows.push({
        key: `${value}-${occurrence}`,
        value,
      })
      return result
    },
    {
      counts: new Map<string, number>(),
      rows: [] as Array<{ key: string; value: string }>,
    },
  ).rows

  const orderedCourseThemes = (courseThemes ?? []) as Array<{
    _id: string
    title: string
  }>

  const currentThemeIndex = orderedCourseThemes.findIndex((theme) => theme._id === data.theme._id)
  const nextTheme = currentThemeIndex >= 0 ? orderedCourseThemes[currentThemeIndex + 1] : null

  const hasStudyNotes = Boolean(data.themeNote.markdown.trim())
  const noteImageUrlMap = data.themeNote.imageUrlMap ?? {}

  return (
    <section className="stack-lg theme-page">
      <article className="panel theme-hero">
        <p className="kicker">{data.course?.title ?? 'Kurz'}</p>
        {isEditingThemeTitle ? (
          <div className="inline-edit-row">
            <input
              aria-label="Názov témy"
              className="inline-edit-input"
              onChange={(event) => setThemeTitleDraft(event.target.value)}
              value={themeTitleDraft}
            />
            <div className="inline-edit-actions">
              <button disabled={isSavingThemeTitle} onClick={saveThemeTitle} type="button">
                {isSavingThemeTitle ? 'Ukladám…' : 'Uložiť'}
              </button>
              <button className="chip" onClick={() => setIsEditingThemeTitle(false)} type="button">
                Zrušiť
              </button>
            </div>
          </div>
        ) : (
          <div className="inline-title-row">
            <h2>
              {data.theme.number}. {data.theme.title}
            </h2>
            <button
              className="text-edit-trigger"
              onClick={() => setIsEditingThemeTitle(true)}
              type="button"
            >
              Upraviť názov
            </button>
          </div>
        )}
      </article>

      <div className={`theme-layout ${isSidebarCollapsed ? 'theme-layout-collapsed' : ''}`}>
        <div className="theme-main stack-lg">
          <article className="panel">
            <div className="row-between compact section-title-row">
              <h3>Poznámky</h3>
              <div className="section-title-actions">
                <button
                  className="text-edit-trigger"
                  onClick={() => setIsSidebarCollapsed((value) => !value)}
                  type="button"
                >
                  {isSidebarCollapsed ? 'Zobraziť panel' : 'Skryť panel'}
                </button>
                <button className="text-edit-trigger" onClick={triggerImportNotes} type="button">
                  {isImportingNotes ? 'Importujem…' : 'Import .md'}
                </button>
                <button className="text-edit-trigger" onClick={exportNotes} type="button">
                  Export .md
                </button>
                {!isEditingNotes ? (
                  <button className="text-edit-trigger" onClick={startNotesEdit} type="button">
                    {hasStudyNotes ? 'Upraviť poznámky' : 'Pridať poznámky'}
                  </button>
                ) : null}
              </div>
            </div>

            <input
              accept=".md,text/markdown"
              hidden
              onChange={onImportInputChange}
              ref={noteImportInputRef}
              type="file"
            />

            {noteError ? <p className="warning">{noteError}</p> : null}

            {isEditingNotes ? (
              <div className="stack-sm">
                <RichTextEditor
                  imageUrlMap={noteImageUrlMap}
                  onChange={setNoteDraft}
                  placeholder="Napíš poznámky k téme…"
                  value={noteDraft}
                />
                <p className="muted-copy">
                  Poznámka sa ukladá ako markdown. Podporované sú formátovanie, zoznamy, tabuľky a
                  obrázky.
                </p>
                <div className="inline-edit-actions">
                  <button disabled={isSavingNotes} onClick={saveNotes} type="button">
                    {isSavingNotes ? 'Ukladám…' : 'Uložiť poznámky'}
                  </button>
                  <button className="chip" onClick={cancelNotesEdit} type="button">
                    Zrušiť
                  </button>
                </div>
              </div>
            ) : hasStudyNotes ? (
              <div className="manual-notes-view">
                <ReactMarkdown
                  components={{
                    img: ({ alt, src }) => {
                      const resolvedSrc = resolveMarkdownImageSrc(
                        String(src ?? ''),
                        noteImageUrlMap,
                      )
                      return resolvedSrc ? (
                        <img alt={alt ?? 'Poznámka'} src={resolvedSrc} />
                      ) : (
                        <p>Obrázok sa nepodarilo načítať.</p>
                      )
                    },
                  }}
                  remarkPlugins={[remarkGfm]}
                  urlTransform={(url) => url}
                >
                  {data.themeNote.markdown}
                </ReactMarkdown>
              </div>
            ) : (
              <EmptyState message="Pre túto tému zatiaľ nie sú poznámky." />
            )}
          </article>
        </div>

        {isSidebarCollapsed ? null : (
          <aside className="theme-sidebar stack-lg">
            <article className="panel">
              <div className="row-between compact section-title-row">
                <h3>Subtémy zo sylabu</h3>
                {isEditingSubthemes ? null : (
                  <button
                    className="text-edit-trigger"
                    onClick={() => setIsEditingSubthemes(true)}
                    type="button"
                  >
                    Upraviť
                  </button>
                )}
              </div>
              {isEditingSubthemes ? (
                <div className="stack-sm">
                  <textarea
                    className="inline-edit-input note-edit-input"
                    onChange={(event) => setSubthemesDraft(event.target.value)}
                    rows={Math.max(5, data.theme.subthemes.length + 1)}
                    value={subthemesDraft}
                  />
                  <p className="muted-copy">Jeden riadok = jedna subtéma.</p>
                  <div className="inline-edit-actions">
                    <button disabled={isSavingSubthemes} onClick={saveSubthemes} type="button">
                      {isSavingSubthemes ? 'Ukladám…' : 'Uložiť'}
                    </button>
                    <button
                      className="chip"
                      onClick={() => setIsEditingSubthemes(false)}
                      type="button"
                    >
                      Zrušiť
                    </button>
                  </div>
                </div>
              ) : data.theme.subthemes.length ? (
                <ul className="stack-xs">
                  {subthemeRows.map((subtheme) => (
                    <li key={subtheme.key}>• {subtheme.value}</li>
                  ))}
                </ul>
              ) : (
                <EmptyState message="V sylabe nie sú explicitné subtémy." />
              )}
            </article>

            <article className="panel">
              <h3>Progress</h3>
              <div className="row-gap theme-meta-row">
                <span className="status-pill" data-status={status}>
                  {progressStatusLabels[status]}
                </span>
                <span
                  className="confidence-pill"
                  data-level={effectiveConfidence}
                  data-status={status}
                >
                  Confidence {effectiveConfidence}/5
                </span>
              </div>
              <div className="grid-2">
                <label className="stack-xs" htmlFor="status">
                  <span>Stav</span>
                  <select
                    id="status"
                    onChange={(event) => setStatus(event.target.value as never)}
                    value={status}
                  >
                    {progressStatuses.map((value) => (
                      <option key={value} value={value}>
                        {progressStatusLabels[value]}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="stack-xs">
                  <span>Zdroj confidence</span>
                  <div className="chip-wrap">
                    <button
                      className={`chip ${confidenceMode === 'derived' ? 'chip-active' : ''}`}
                      disabled={!data.theme.subthemes.length}
                      onClick={() => setConfidenceMode('derived')}
                      type="button"
                    >
                      Priemer subtém
                    </button>
                    <button
                      className={`chip ${confidenceMode === 'manual' ? 'chip-active' : ''}`}
                      onClick={() => setConfidenceMode('manual')}
                      type="button"
                    >
                      Globálny override
                    </button>
                  </div>
                </div>
              </div>
              <label className="stack-xs" htmlFor="manual-confidence">
                <span>Globálne confidence (override): {clampConfidence(manualConfidence)}/5</span>
                <input
                  id="manual-confidence"
                  max={5}
                  min={0}
                  onChange={(event) =>
                    setManualConfidence(clampConfidence(Number(event.target.value)))
                  }
                  step={1}
                  type="range"
                  value={clampConfidence(manualConfidence)}
                />
              </label>
              {data.theme.subthemes.length ? (
                <div className="stack-sm subtheme-confidence-list">
                  <p className="muted-copy">Priemer subtém: {derivedConfidence}/5</p>
                  {data.theme.subthemes.map((subtheme, index) => (
                    <label
                      className="stack-xs subtheme-confidence-row"
                      htmlFor={`subtheme-confidence-${index}`}
                      key={`${subtheme}-${index}`}
                    >
                      <span>
                        {index + 1}. {subtheme} ({normalizedSubthemeConfidences[index]}/5)
                      </span>
                      <input
                        id={`subtheme-confidence-${index}`}
                        max={5}
                        min={0}
                        onChange={(event) =>
                          setSubthemeConfidences((current) => {
                            const next = [...current]
                            next[index] = clampConfidence(Number(event.target.value))
                            return next
                          })
                        }
                        step={1}
                        type="range"
                        value={normalizedSubthemeConfidences[index]}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <button disabled={isSaving} onClick={onSaveProgress} type="button">
                {isSaving ? 'Ukladám…' : 'Uložiť progress'}
              </button>
              {nextTheme ? (
                <div className="stack-xs next-theme-cta">
                  <p className="muted-copy">Pokračovať na ďalšiu tému</p>
                  <Link className="button" to={`/theme/${nextTheme._id}`}>
                    Ďalšia téma: {nextTheme.title}
                  </Link>
                </div>
              ) : (
                <p className="muted-copy">Toto je posledná téma v tomto kurze.</p>
              )}
            </article>
          </aside>
        )}
      </div>
    </section>
  )
}
