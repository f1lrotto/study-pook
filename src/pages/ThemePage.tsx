import { Fragment, useEffect, useMemo, useState } from 'react'

import { useMutation, useQuery } from 'convex/react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../../convex/_generated/api'
import { RichTextEditor } from '../components/RichTextEditor'
import { EmptyState, LoadingState } from '../components/States'
import { progressStatuses, progressStatusLabels } from '../lib/statuses'
import { useUserStore } from '../store/useUserStore'

type RenderNoteBlock = {
  key: string
  kind: 'text' | 'image' | 'table'
  entries?: Array<{
    blockId: string
    role: 'paragraph' | 'list_item' | 'subheading'
    listLevel: number
    segments: RichTextSegment[]
  }>
  blockId?: string
  text?: string
  imageUrl?: string
  sourceImageName?: string
}

type RichTextSegment = {
  text: string
  bold?: boolean
}

type EditableTextEntry = {
  role: 'paragraph' | 'list_item' | 'subheading'
  listLevel: number
  segments: RichTextSegment[]
}

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
  const updateNoteBlockText = useMutation(api.study.updateNoteBlockText)
  const saveThemeManualNotes = useMutation(api.study.saveThemeManualNotes)

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
  const [editingNoteMode, setEditingNoteMode] = useState<'text' | 'table' | null>(null)
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null)
  const [editingNoteBlockIds, setEditingNoteBlockIds] = useState<string[]>([])
  const [editingNoteBaseEntries, setEditingNoteBaseEntries] = useState<EditableTextEntry[]>([])
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNoteKey, setSavingNoteKey] = useState<string | null>(null)
  const [isEditingManualNotes, setIsEditingManualNotes] = useState(false)
  const [manualNotesDraft, setManualNotesDraft] = useState('')
  const [isSavingManualNotes, setIsSavingManualNotes] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

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

    if (!isEditingManualNotes) {
      setManualNotesDraft(data.theme.manualNotesHtml ?? '')
    }
  }, [data, isEditingManualNotes, isEditingSubthemes, isEditingThemeTitle])

  const renderNoteBlocks = useMemo<RenderNoteBlock[]>(() => {
    if (!data) {
      return []
    }

    const merged = [] as RenderNoteBlock[]
    const bufferedTextEntries = [] as NonNullable<RenderNoteBlock['entries']>
    const bufferedIds = [] as string[]

    const parseRichSegments = (rawText?: string, rawJson?: string): RichTextSegment[] => {
      const normalize = (value: string) => value.replace(/\s+/g, ' ').trim()

      if (rawJson) {
        try {
          const parsed = JSON.parse(rawJson) as unknown
          if (Array.isArray(parsed)) {
            const segments = parsed.reduce<RichTextSegment[]>((acc, item) => {
              if (!item || typeof item !== 'object') {
                return acc
              }

              const text = normalize(String((item as Record<string, unknown>).text ?? ''))
              if (!text) {
                return acc
              }

              acc.push({
                text,
                bold: (item as Record<string, unknown>).bold ? true : undefined,
              })
              return acc
            }, [])

            if (segments.length) {
              return segments
            }
          }
        } catch {
          // Keep fallback behavior below when JSON payload is invalid.
        }
      }

      const fallback = normalize(rawText ?? '')
      return fallback ? [{ text: fallback }] : []
    }

    const flushText = () => {
      if (!bufferedTextEntries.length || !bufferedIds.length) {
        bufferedTextEntries.length = 0
        bufferedIds.length = 0
        return
      }

      merged.push({
        key: `text-${bufferedIds[0]}-${bufferedIds[bufferedIds.length - 1]}`,
        kind: 'text',
        entries: [...bufferedTextEntries],
      })

      bufferedTextEntries.length = 0
      bufferedIds.length = 0
    }

    for (const block of data.noteBlocks) {
      if (block.kind === 'text') {
        const segments = parseRichSegments(block.text ?? undefined, block.richTextJson ?? undefined)
        if (!segments.length) {
          continue
        }

        bufferedTextEntries.push({
          blockId: String(block._id),
          role:
            block.textRole === 'list_item' || block.textRole === 'subheading'
              ? block.textRole
              : 'paragraph',
          listLevel:
            typeof block.listLevel === 'number' && Number.isFinite(block.listLevel)
              ? Math.max(0, Math.floor(block.listLevel))
              : 0,
          segments,
        })
        bufferedIds.push(String(block._id))
        continue
      }

      flushText()

      if (block.kind === 'image') {
        merged.push({
          key: String(block._id),
          kind: 'image',
          imageUrl: block.imageUrl ?? undefined,
          sourceImageName: block.sourceImageName ?? undefined,
        })
        continue
      }

      merged.push({
        key: String(block._id),
        kind: 'table',
        blockId: String(block._id),
        text: block.text ?? '',
      })
    }

    flushText()

    return merged
  }, [data])

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

  const normalizeLine = (value: string) => value.trim().replace(/\s+/g, ' ')
  const noteSegmentsToText = (segments: RichTextSegment[]) =>
    normalizeLine(segments.map((segment) => segment.text).join(' '))

  const cloneEntry = (entry: EditableTextEntry) => ({
    role: entry.role,
    listLevel: entry.listLevel,
    segments: entry.segments.map((segment) => ({ ...segment })),
  })

  const escapeHtml = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')

  const segmentsToHtml = (segments: RichTextSegment[]) =>
    segments
      .map((segment) => {
        const text = normalizeLine(segment.text)
        if (!text) {
          return ''
        }

        const escaped = escapeHtml(text)
        return segment.bold ? `<strong>${escaped}</strong>` : escaped
      })
      .filter(Boolean)
      .join(' ')

  const entriesToEditorHtml = (entries: EditableTextEntry[]) => {
    let html = ''
    let inList = false

    for (const entry of entries) {
      const inlineHtml = segmentsToHtml(entry.segments)
      if (!inlineHtml) {
        continue
      }

      if (entry.role === 'list_item') {
        if (!inList) {
          html += '<ul>'
          inList = true
        }

        html += `<li>${inlineHtml}</li>`
        continue
      }

      if (inList) {
        html += '</ul>'
        inList = false
      }

      html += entry.role === 'subheading' ? `<h3>${inlineHtml}</h3>` : `<p>${inlineHtml}</p>`
    }

    if (inList) {
      html += '</ul>'
    }

    return html || '<p></p>'
  }

  const pushSegment = (segments: RichTextSegment[], value: string, bold: boolean) => {
    const normalized = normalizeLine(value)
    if (!normalized) {
      return
    }

    const previous = segments.at(-1)
    if (previous && Boolean(previous.bold) === bold) {
      previous.text = `${previous.text} ${normalized}`
      return
    }

    segments.push({
      text: normalized,
      bold: bold || undefined,
    })
  }

  const readSegmentsFromNodes = (nodes: ChildNode[]) => {
    const segments = [] as RichTextSegment[]

    const walk = (node: ChildNode, bold: boolean) => {
      if (node.nodeType === 3) {
        pushSegment(segments, node.textContent ?? '', bold)
        return
      }

      if (node.nodeType !== 1) {
        return
      }

      const element = node as HTMLElement
      const tag = element.tagName.toLowerCase()
      const nextBold = bold || tag === 'strong' || tag === 'b'

      if (tag === 'br') {
        return
      }

      for (const child of Array.from(element.childNodes)) {
        walk(child, nextBold)
      }
    }

    for (const node of nodes) {
      walk(node, false)
    }

    return segments
  }

  const parseEditorHtmlToEntries = (html: string) => {
    if (typeof DOMParser === 'undefined') {
      return [] as EditableTextEntry[]
    }

    const parsed = new DOMParser().parseFromString(html, 'text/html')
    const entries = [] as EditableTextEntry[]

    const pushEntry = (
      role: EditableTextEntry['role'],
      listLevel: number,
      segments: RichTextSegment[],
    ) => {
      if (!noteSegmentsToText(segments)) {
        return
      }

      entries.push({
        role,
        listLevel: role === 'paragraph' ? 0 : Math.max(0, Math.floor(listLevel)),
        segments,
      })
    }

    const parseList = (listNode: Element, level: number) => {
      const listItems = Array.from(listNode.children).filter(
        (child) => child.tagName.toLowerCase() === 'li',
      )

      for (const item of listItems) {
        const li = item as HTMLElement
        const inlineNodes = Array.from(li.childNodes).filter((child) => {
          if (child.nodeType !== 1) {
            return true
          }

          const tag = (child as HTMLElement).tagName.toLowerCase()
          return tag !== 'ul' && tag !== 'ol'
        })

        pushEntry('list_item', level, readSegmentsFromNodes(inlineNodes))

        const nestedLists = Array.from(li.children).filter((child) => {
          const tag = child.tagName.toLowerCase()
          return tag === 'ul' || tag === 'ol'
        })

        for (const nested of nestedLists) {
          parseList(nested, level + 1)
        }
      }
    }

    const parseNode = (node: ChildNode) => {
      if (node.nodeType === 3) {
        pushEntry('paragraph', 0, readSegmentsFromNodes([node]))
        return
      }

      if (node.nodeType !== 1) {
        return
      }

      const element = node as HTMLElement
      const tag = element.tagName.toLowerCase()

      if (tag === 'ul' || tag === 'ol') {
        parseList(element, 0)
        return
      }

      if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5') {
        pushEntry('subheading', 0, readSegmentsFromNodes(Array.from(element.childNodes)))
        return
      }

      if (tag === 'li') {
        pushEntry('list_item', 0, readSegmentsFromNodes(Array.from(element.childNodes)))
        return
      }

      if (tag === 'div' && element.children.length) {
        for (const child of Array.from(element.childNodes)) {
          parseNode(child)
        }
        return
      }

      pushEntry('paragraph', 0, readSegmentsFromNodes(Array.from(element.childNodes)))
    }

    for (const node of Array.from(parsed.body.childNodes)) {
      parseNode(node)
    }

    return entries
  }

  const alignEntriesToBlockCount = (
    parsedEntries: EditableTextEntry[],
    baseEntries: EditableTextEntry[],
    targetCount: number,
  ) => {
    const normalizedParsed = parsedEntries.filter((entry) => noteSegmentsToText(entry.segments))
    const source = (normalizedParsed.length ? normalizedParsed : baseEntries).map(cloneEntry)

    const selected = source.slice(0, targetCount)

    while (selected.length < targetCount) {
      const fallback = baseEntries[selected.length] ?? source[source.length - 1]
      if (!fallback) {
        break
      }

      selected.push(cloneEntry(fallback))
    }

    if (source.length > targetCount && selected.length) {
      const overflowText = source
        .slice(targetCount)
        .map((entry) => noteSegmentsToText(entry.segments))
        .filter(Boolean)
        .join(' ')

      if (overflowText) {
        const lastIndex = selected.length - 1
        const mergedText = normalizeLine(
          `${noteSegmentsToText(selected[lastIndex].segments)} ${overflowText}`,
        )

        selected[lastIndex] = {
          role: selected[lastIndex].role,
          listLevel: selected[lastIndex].listLevel,
          segments: [{ text: mergedText, bold: selected[lastIndex].role === 'subheading' }],
        }
      }
    }

    return selected.map((entry) => ({
      ...entry,
      listLevel: entry.role === 'paragraph' ? 0 : Math.max(0, Math.floor(entry.listLevel)),
    }))
  }

  const renderSegments = (entry: { blockId: string; segments: RichTextSegment[] }) => {
    let offset = 0

    return entry.segments.map((segment, segmentIndex) => {
      const key = `${entry.blockId}-${offset}-${segment.bold ? '1' : '0'}`
      offset += segment.text.length + 1

      return (
        <Fragment key={key}>
          {segmentIndex ? ' ' : null}
          {segment.bold ? (
            <strong className="note-segment-strong">{segment.text}</strong>
          ) : (
            segment.text
          )}
        </Fragment>
      )
    })
  }

  const resetNoteEdit = () => {
    setEditingNoteMode(null)
    setEditingNoteKey(null)
    setEditingNoteBlockIds([])
    setEditingNoteBaseEntries([])
    setNoteDraft('')
  }

  const startTextBlockEdit = (block: RenderNoteBlock) => {
    if (block.kind !== 'text') {
      return
    }

    const entries = (block.entries ?? []).map((entry) => ({
      role: entry.role,
      listLevel: entry.listLevel,
      segments: entry.segments.map((segment) => ({ ...segment })),
    }))
    const blockIds = (block.entries ?? []).map((entry) => entry.blockId)

    if (!entries.length || !blockIds.length) {
      return
    }

    setEditingNoteMode('text')
    setEditingNoteKey(block.key)
    setEditingNoteBlockIds(blockIds)
    setEditingNoteBaseEntries(entries)
    setNoteDraft(entriesToEditorHtml(entries))
  }

  const startSingleBlockEdit = (blockKey: string, blockId: string, text: string) => {
    setEditingNoteMode('table')
    setEditingNoteKey(blockKey)
    setEditingNoteBlockIds([blockId])
    setEditingNoteBaseEntries([])
    setNoteDraft(text)
  }

  const saveNoteEdit = async () => {
    if (!editingNoteKey || !editingNoteMode || !editingNoteBlockIds.length) {
      return
    }

    setSavingNoteKey(editingNoteKey)

    try {
      if (editingNoteMode === 'table') {
        const text = normalizeLine(noteDraft)
        const blockId = editingNoteBlockIds[0]

        if (!blockId || !text) {
          return
        }

        await updateNoteBlockText({
          blockId: blockId as never,
          text,
        })
      } else {
        if (!editingNoteBaseEntries.length) {
          return
        }

        const parsedEntries = parseEditorHtmlToEntries(noteDraft)
        const alignedEntries = alignEntriesToBlockCount(
          parsedEntries,
          editingNoteBaseEntries,
          editingNoteBlockIds.length,
        )

        await Promise.all(
          editingNoteBlockIds.map((blockId, index) => {
            const fallback = editingNoteBaseEntries[index]
            const entry = alignedEntries[index] ?? fallback
            if (!entry) {
              return Promise.resolve(null)
            }

            const fallbackText = fallback ? noteSegmentsToText(fallback.segments) : ''
            const text = noteSegmentsToText(entry.segments) || fallbackText

            return updateNoteBlockText({
              blockId: blockId as never,
              text,
              textRole: entry.role,
              listLevel: entry.role === 'paragraph' ? undefined : entry.listLevel,
              richTextJson: JSON.stringify(entry.segments),
            })
          }),
        )
      }

      resetNoteEdit()
    } finally {
      setSavingNoteKey(null)
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

  const hasImportedNotes = renderNoteBlocks.length > 0
  const hasManualNotes = Boolean(data.theme.manualNotesHtml?.trim())
  const orderedCourseThemes = (courseThemes ?? []) as Array<{
    _id: string
    title: string
  }>
  const currentThemeIndex = orderedCourseThemes.findIndex((theme) => theme._id === data.theme._id)
  const nextTheme = currentThemeIndex >= 0 ? orderedCourseThemes[currentThemeIndex + 1] : null

  const startManualNotesEdit = () => {
    setManualNotesDraft(data.theme.manualNotesHtml ?? '')
    setIsEditingManualNotes(true)
  }

  const cancelManualNotesEdit = () => {
    setIsEditingManualNotes(false)
    setManualNotesDraft(data.theme.manualNotesHtml ?? '')
  }

  const saveManualNotes = async () => {
    setIsSavingManualNotes(true)

    try {
      await saveThemeManualNotes({
        themeId: data.theme._id,
        html: manualNotesDraft,
      })
      setIsEditingManualNotes(false)
    } finally {
      setIsSavingManualNotes(false)
    }
  }

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
                {!hasImportedNotes && !isEditingManualNotes ? (
                  <button
                    className="text-edit-trigger"
                    onClick={startManualNotesEdit}
                    type="button"
                  >
                    {hasManualNotes ? 'Upraviť poznámky' : 'Pridať poznámky'}
                  </button>
                ) : null}
              </div>
            </div>
            {!hasImportedNotes ? (
              isEditingManualNotes ? (
                <div className="stack-sm">
                  <RichTextEditor
                    onChange={setManualNotesDraft}
                    placeholder="Napíš vlastné poznámky k téme…"
                    value={manualNotesDraft}
                  />
                  <p className="muted-copy">
                    Podporované je formátovanie textu, odrážky a vloženie obrázkov (aj cez paste).
                  </p>
                  <div className="inline-edit-actions">
                    <button disabled={isSavingManualNotes} onClick={saveManualNotes} type="button">
                      {isSavingManualNotes ? 'Ukladám…' : 'Uložiť poznámky'}
                    </button>
                    <button className="chip" onClick={cancelManualNotesEdit} type="button">
                      Zrušiť
                    </button>
                  </div>
                </div>
              ) : hasManualNotes ? (
                <div
                  className="manual-notes-view"
                  dangerouslySetInnerHTML={{ __html: data.theme.manualNotesHtml ?? '' }}
                />
              ) : (
                <EmptyState message="Pre túto tému zatiaľ nie sú importované poznámky." />
              )
            ) : (
              <ul className="stack-md note-blocks">
                {renderNoteBlocks.map((block) => (
                  <li className={`note-item note-item-${block.kind}`} key={block.key}>
                    {block.kind === 'image' ? (
                      block.imageUrl ? (
                        <img alt={block.sourceImageName ?? 'Poznámka'} src={block.imageUrl} />
                      ) : (
                        <p>Obrázok sa nepodarilo načítať.</p>
                      )
                    ) : block.kind === 'table' ? (
                      editingNoteKey === block.key ? (
                        <div className="stack-xs note-edit-wrap">
                          <textarea
                            className="inline-edit-input note-edit-input"
                            onChange={(event) => setNoteDraft(event.target.value)}
                            rows={6}
                            value={noteDraft}
                          />
                          <div className="inline-edit-actions">
                            <button
                              disabled={savingNoteKey === block.key}
                              onClick={saveNoteEdit}
                              type="button"
                            >
                              {savingNoteKey === block.key ? 'Ukladám…' : 'Uložiť'}
                            </button>
                            <button className="chip" onClick={resetNoteEdit} type="button">
                              Zrušiť
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="note-line-row">
                          <pre>{block.text}</pre>
                          <button
                            className="text-edit-trigger note-edit-trigger"
                            disabled={!block.blockId}
                            onClick={() =>
                              block.blockId
                                ? startSingleBlockEdit(block.key, block.blockId, block.text ?? '')
                                : undefined
                            }
                            type="button"
                          >
                            Upraviť
                          </button>
                        </div>
                      )
                    ) : editingNoteKey === block.key ? (
                      <div className="stack-xs note-edit-wrap">
                        <RichTextEditor onChange={setNoteDraft} value={noteDraft} />
                        <p className="muted-copy">
                          Uprav formátovanie, odrážky aj zvýraznenia pre celý blok naraz.
                        </p>
                        <div className="inline-edit-actions">
                          <button
                            disabled={savingNoteKey === block.key}
                            onClick={saveNoteEdit}
                            type="button"
                          >
                            {savingNoteKey === block.key ? 'Ukladám…' : 'Uložiť'}
                          </button>
                          <button className="chip" onClick={resetNoteEdit} type="button">
                            Zrušiť
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="note-item-toolbar">
                          <button
                            className="text-edit-trigger note-edit-trigger"
                            onClick={() => startTextBlockEdit(block)}
                            type="button"
                          >
                            Upraviť poznámku
                          </button>
                        </div>
                        <div className="note-structured">
                          {(block.entries ?? []).map((entry) => (
                            <p
                              className={`note-line ${
                                entry.role === 'subheading'
                                  ? 'note-subheading'
                                  : entry.role === 'list_item'
                                    ? 'note-list-item'
                                    : 'note-paragraph'
                              }`}
                              data-level={entry.listLevel}
                              key={entry.blockId}
                            >
                              {renderSegments(entry)}
                            </p>
                          ))}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
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
