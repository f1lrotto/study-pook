import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'

import { XMLParser } from 'fast-xml-parser'
import JSZip from 'jszip'

import type { ParsedDocxNotes, ParsedNoteBlock, ThemeLookup } from './types'
import { cleanLine, normalizeText, scoreNameMatch, slugify } from './utils'

const readTextNode = (node: unknown): string => {
  if (node === null || node === undefined) {
    return ''
  }

  if (typeof node === 'string') {
    return node
  }

  if (Array.isArray(node)) {
    return node.map((item) => readTextNode(item)).join('')
  }

  if (typeof node === 'object') {
    if ('#text' in node) {
      return String((node as Record<string, unknown>)['#text'] ?? '')
    }

    return Object.entries(node)
      .filter(([key]) => key !== ':@')
      .map(([, value]) => readTextNode(value))
      .join('')
  }

  return ''
}

const collectEmbedIds = (node: unknown): string[] => {
  if (!node) {
    return []
  }

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectEmbedIds(item))
  }

  if (typeof node === 'object') {
    const asRecord = node as Record<string, unknown>
    const current =
      'a:blip' in asRecord
        ? [String((asRecord[':@'] as Record<string, string> | undefined)?.['r:embed'] ?? '')]
        : []

    const nested = Object.entries(asRecord)
      .filter(([key]) => key !== ':@')
      .flatMap(([, value]) => collectEmbedIds(value))

    return [...current, ...nested].filter(Boolean)
  }

  return []
}

const collectTextFragments = (node: unknown): string[] => {
  if (!node) {
    return []
  }

  if (Array.isArray(node)) {
    return node.flatMap((item) => collectTextFragments(item))
  }

  if (typeof node === 'object') {
    const asRecord = node as Record<string, unknown>

    if ('w:t' in asRecord) {
      const text = readTextNode(asRecord['w:t'])
      return text ? [text] : []
    }

    return Object.entries(asRecord)
      .filter(([key]) => key !== ':@')
      .flatMap(([, value]) => collectTextFragments(value))
  }

  return []
}

const readAttribute = (node: unknown, key: string) => {
  if (!node || typeof node !== 'object') {
    return undefined
  }

  const attrs = (node as Record<string, unknown>)[':@']
  if (!attrs || typeof attrs !== 'object') {
    return undefined
  }

  const value = (attrs as Record<string, unknown>)[key]
  return value === undefined || value === null ? undefined : String(value)
}

const isEnabledWordFlag = (value: unknown) => {
  if (value === undefined || value === null) {
    return true
  }

  const normalized = String(value).toLowerCase()
  return normalized !== '0' && normalized !== 'false' && normalized !== 'off'
}

const isRunBold = (runNode: Array<Record<string, unknown>>) => {
  const runProps = runNode.find((item) => 'w:rPr' in item)?.['w:rPr'] as
    | Array<Record<string, unknown>>
    | undefined

  if (!runProps) {
    return false
  }

  const bold = runProps.find((item) => 'w:b' in item)
  const boldComplex = runProps.find((item) => 'w:bCs' in item)

  return Boolean(
    (bold && isEnabledWordFlag(readAttribute(bold, 'w:val'))) ||
    (boldComplex && isEnabledWordFlag(readAttribute(boldComplex, 'w:val'))),
  )
}

const getParagraphListLevel = (paragraphProps?: Array<Record<string, unknown>>) => {
  if (!paragraphProps) {
    return null
  }

  const numPr = paragraphProps.find((item) => 'w:numPr' in item)?.['w:numPr'] as
    | Array<Record<string, unknown>>
    | undefined

  if (!numPr) {
    return null
  }

  const ilvl = numPr.find((item) => 'w:ilvl' in item)
  if (!ilvl) {
    return 0
  }

  const raw = readAttribute(ilvl, 'w:val')
  if (!raw) {
    return 0
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeInlineText = (value: string) => value.replace(/\s+/g, ' ').trim()

const pushRichSegment = (
  segments: Array<{ text: string; bold?: boolean }>,
  value: string,
  bold: boolean,
) => {
  const normalized = normalizeInlineText(value)
  if (!normalized) {
    return
  }

  const previous = segments.at(-1)
  const previousBold = Boolean(previous?.bold)

  if (previous && previousBold === bold) {
    previous.text = `${previous.text} ${normalized}`
    return
  }

  segments.push({
    text: normalized,
    bold: bold || undefined,
  })
}

const getBodyNodes = (documentXml: string) => {
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    attributeNamePrefix: '',
    trimValues: false,
  })

  const parsed = parser.parse(documentXml) as Array<Record<string, unknown>>
  const documentNode = parsed.find((node) => 'w:document' in node)?.['w:document'] as
    | Array<Record<string, unknown>>
    | undefined
  const bodyNode = documentNode?.find((node) => 'w:body' in node)?.['w:body'] as
    | Array<Record<string, unknown>>
    | undefined

  return bodyNode ?? []
}

const getRelationshipMap = (relsXml: string) => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
  })

  const parsed = parser.parse(relsXml) as {
    Relationships?: {
      Relationship?:
        | {
            Id: string
            Target: string
          }
        | Array<{
            Id: string
            Target: string
          }>
    }
  }

  const rawRelations = parsed.Relationships?.Relationship
  const relations = Array.isArray(rawRelations) ? rawRelations : rawRelations ? [rawRelations] : []

  return new Map(relations.map((item) => [item.Id, item.Target]))
}

const buildThemeResolver = (themes: ThemeLookup[]) => {
  const normalizedThemes = themes.map((theme) => ({
    ...theme,
    normalizedTitle: normalizeText(theme.normalizedTitle || theme.title),
  }))

  const byExact = new Map(normalizedThemes.map((theme) => [theme.normalizedTitle, theme]))

  return (heading: string) => {
    const normalizedHeading = normalizeText(heading.replace(/^\d+\.\s*/, ''))

    const exact = byExact.get(normalizedHeading)
    if (exact) {
      return exact
    }

    const best = normalizedThemes
      .map((theme) => ({
        theme,
        score: scoreNameMatch(theme.normalizedTitle, normalizedHeading),
      }))
      .sort((a, b) => b.score - a.score)[0]

    if (!best || best.score < 0.55) {
      return null
    }

    return best.theme
  }
}

const createBlock = (
  themeId: string,
  orderByTheme: Map<string, number>,
  block: Omit<ParsedNoteBlock, 'order' | 'externalKey'>,
) => {
  const nextOrder = (orderByTheme.get(themeId) ?? 0) + 1
  orderByTheme.set(themeId, nextOrder)

  const tokenBase = block.text || block.sourceImageName || `${block.kind}-${nextOrder}`

  return {
    ...block,
    order: nextOrder,
    externalKey: `${String(nextOrder).padStart(4, '0')}-${block.kind}-${slugify(tokenBase).slice(0, 80)}`,
  }
}

export const extractNotesFromDocx = async (
  docxPath: string,
  themeLookup: ThemeLookup[],
): Promise<ParsedDocxNotes> => {
  const zip = await JSZip.loadAsync(await readFile(docxPath))

  const documentXml = await zip.file('word/document.xml')?.async('text')
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('text')

  if (!documentXml || !relsXml) {
    throw new Error('DOCX does not contain required XML files.')
  }

  const bodyNodes = getBodyNodes(documentXml)
  const relationshipMap = getRelationshipMap(relsXml)

  const resolveTheme = buildThemeResolver(themeLookup)

  const blocksByTheme = new Map<string, ParsedNoteBlock[]>()
  const orderByTheme = new Map<string, number>()
  const usedImageTargets = new Set<string>()
  const unmatchedHeadings = [] as string[]

  let currentThemeId: string | null = null

  const pushBlock = (themeId: string, block: Omit<ParsedNoteBlock, 'order' | 'externalKey'>) => {
    const next = blocksByTheme.get(themeId) ?? []
    next.push(createBlock(themeId, orderByTheme, block))
    blocksByTheme.set(themeId, next)
  }

  for (const bodyNode of bodyNodes) {
    const paragraph = bodyNode['w:p'] as Array<Record<string, unknown>> | undefined
    const table = bodyNode['w:tbl'] as Array<Record<string, unknown>> | undefined

    if (paragraph) {
      const paragraphProps = paragraph.find((item) => 'w:pPr' in item)?.['w:pPr'] as
        | Array<Record<string, unknown>>
        | undefined
      const paragraphStyleNode = paragraphProps?.find((item) => 'w:pStyle' in item)
      const paragraphStyle = (paragraphStyleNode?.[':@'] as Record<string, string> | undefined)?.[
        'w:val'
      ]
      const listLevel = getParagraphListLevel(paragraphProps)

      const runNodes = paragraph
        .map((item) => item['w:r'] as Array<Record<string, unknown>> | undefined)
        .filter((node): node is Array<Record<string, unknown>> => Boolean(node))

      const tokens: Array<
        | { kind: 'text'; value: string; bold: boolean }
        | { kind: 'image'; sourceImageName: string; imageTarget: string }
      > = []

      for (const runNode of runNodes) {
        const bold = isRunBold(runNode)

        for (const runChild of runNode) {
          const textParts = collectTextFragments(runChild)
          const textValue = normalizeInlineText(textParts.join(' '))

          if (textValue) {
            tokens.push({
              kind: 'text',
              value: textValue,
              bold,
            })
          }

          const embedIds = collectEmbedIds(runChild)
          for (const embedId of embedIds) {
            const target = relationshipMap.get(embedId)
            if (!target || !target.startsWith('media/')) {
              continue
            }

            tokens.push({
              kind: 'image',
              sourceImageName: basename(target),
              imageTarget: target,
            })
          }
        }
      }

      const headingText = cleanLine(
        tokens
          .filter((token) => token.kind === 'text')
          .map((token) => token.value)
          .join(' '),
      )

      if (paragraphStyle === 'Heading2' && headingText) {
        const matchedTheme = resolveTheme(headingText)

        if (matchedTheme) {
          currentThemeId = matchedTheme.id
        } else {
          unmatchedHeadings.push(headingText)
        }

        continue
      }

      if (!currentThemeId || tokens.length === 0) {
        continue
      }

      const richTextBuffer = [] as Array<{ text: string; bold?: boolean }>

      const flushText = () => {
        if (!richTextBuffer.length) {
          return
        }

        const value = cleanLine(richTextBuffer.map((segment) => segment.text).join(' '))
        if (!value) {
          richTextBuffer.length = 0
          return
        }

        const leadingSegment = richTextBuffer.find((segment) => segment.text.trim())
        const textRole =
          listLevel === null
            ? 'paragraph'
            : listLevel === 0 && leadingSegment?.bold
              ? 'subheading'
              : 'list_item'

        pushBlock(currentThemeId as string, {
          kind: 'text',
          text: value,
          textRole,
          listLevel: listLevel === null ? undefined : listLevel,
          richTextJson: JSON.stringify(richTextBuffer),
        })
        richTextBuffer.length = 0
      }

      for (const token of tokens) {
        if (token.kind === 'text') {
          pushRichSegment(richTextBuffer, token.value, token.bold)
          continue
        }

        flushText()

        pushBlock(currentThemeId, {
          kind: 'image',
          sourceImageName: token.sourceImageName,
          imageTarget: token.imageTarget,
        })

        usedImageTargets.add(token.imageTarget)
      }

      flushText()
      continue
    }

    if (table && currentThemeId) {
      const tableText = collectTextFragments(table)
        .map((text) => cleanLine(text))
        .filter(Boolean)
        .join('\n')

      if (tableText) {
        pushBlock(currentThemeId, {
          kind: 'table',
          text: tableText,
        })
      }
    }
  }

  const imageBytesByTarget = new Map<string, Uint8Array>()
  for (const target of usedImageTargets) {
    const file = zip.file(`word/${target}`)
    if (!file) {
      continue
    }

    const bytes = await file.async('uint8array')
    imageBytesByTarget.set(target, bytes)
  }

  return {
    blocksByTheme,
    imageBytesByTarget,
    unmatchedHeadings,
  }
}
