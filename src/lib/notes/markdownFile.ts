export const noteFileFormat = 'study-pook-note/v1'
export const noteImageStrategy = 'convex-storage-uri'

const storageImageUriPattern = /^convex:\/\/storage\/([a-zA-Z0-9_-]+)(?:\?name=([^&]+))?$/

const cleanLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const quoteYamlValue = (value: string) => JSON.stringify(value)

const normalizeMarkdown = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, '\n')

const parseYamlScalar = (rawValue: string) => {
  const value = rawValue.trim()
  if (!value) {
    return ''
  }

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return String(JSON.parse(value))
    } catch {
      return value.slice(1, -1)
    }
  }

  return value
}

const parseSimpleFrontmatter = (rawContent: string) => {
  const content = normalizeNewlines(rawContent)

  if (!content.startsWith('---\n')) {
    throw new Error('Súbor poznámky musí začínať YAML frontmatter blokom.')
  }

  const closeIndex = content.indexOf('\n---\n', 4)
  if (closeIndex < 0) {
    throw new Error('Súbor poznámky nemá uzavretý YAML frontmatter blok.')
  }

  const rawFrontmatter = content.slice(4, closeIndex)
  const markdown = content.slice(closeIndex + '\n---\n'.length)

  const data = rawFrontmatter.split('\n').reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      return acc
    }

    const separatorIndex = trimmed.indexOf(':')
    if (separatorIndex <= 0) {
      return acc
    }

    const key = trimmed.slice(0, separatorIndex).trim()
    const value = trimmed.slice(separatorIndex + 1)
    acc[key] = parseYamlScalar(value)
    return acc
  }, {})

  return { data, markdown }
}

export const parseStorageImageUri = (uri: string) => {
  const match = uri.match(storageImageUriPattern)
  if (!match) {
    return null
  }

  return {
    storageId: match[1],
    imageName: match[2] ? decodeURIComponent(match[2]) : undefined,
  }
}

export const resolveMarkdownImageSrc = (src: string, imageUrlMap: Record<string, string>) => {
  const parsed = parseStorageImageUri(src)
  return parsed ? (imageUrlMap[parsed.storageId] ?? '') : src
}

export const serializeThemeNoteFile = (args: {
  themeSlug: string
  themeTitle: string
  markdown: string
  exportedAt?: string
}) => {
  const exportedAt = args.exportedAt ?? new Date().toISOString()
  const markdown = normalizeMarkdown(args.markdown)

  return [
    '---',
    `format: ${quoteYamlValue(noteFileFormat)}`,
    `themeSlug: ${quoteYamlValue(cleanLine(args.themeSlug))}`,
    `themeTitle: ${quoteYamlValue(cleanLine(args.themeTitle))}`,
    `imageStrategy: ${quoteYamlValue(noteImageStrategy)}`,
    `exportedAt: ${quoteYamlValue(exportedAt)}`,
    '---',
    '',
    markdown,
    '',
  ].join('\n')
}

export const parseThemeNoteFile = (rawContent: string) => {
  const parsed = parseSimpleFrontmatter(rawContent)
  const format = cleanLine(String(parsed.data.format ?? ''))
  const themeSlug = cleanLine(String(parsed.data.themeSlug ?? ''))
  const themeTitle = cleanLine(String(parsed.data.themeTitle ?? ''))
  const imageStrategy = cleanLine(String(parsed.data.imageStrategy ?? ''))

  if (format !== noteFileFormat) {
    throw new Error(`Neplatný formát súboru. Očakávam ${noteFileFormat}.`)
  }

  if (!themeSlug) {
    throw new Error('Súbor poznámky nemá themeSlug vo frontmatter.')
  }

  if (!themeTitle) {
    throw new Error('Súbor poznámky nemá themeTitle vo frontmatter.')
  }

  if (imageStrategy !== noteImageStrategy) {
    throw new Error(`Neplatná imageStrategy. Očakávam ${noteImageStrategy}.`)
  }

  return {
    frontmatter: {
      format,
      themeSlug,
      themeTitle,
      imageStrategy,
      exportedAt: cleanLine(String(parsed.data.exportedAt ?? '')),
    },
    markdown: normalizeMarkdown(parsed.markdown),
  }
}
