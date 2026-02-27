import { describe, expect, test } from 'vitest'

import {
  noteFileFormat,
  parseStorageImageUri,
  parseThemeNoteFile,
  resolveMarkdownImageSrc,
  serializeThemeNoteFile,
} from './markdownFile'

describe('markdownFile utilities', () => {
  test('serializes and parses note file with frontmatter', () => {
    const content = serializeThemeNoteFile({
      themeSlug: 'tema-1',
      themeTitle: 'Téma 1',
      markdown: '# Heading\\n\\nText',
      exportedAt: '2026-02-27T00:00:00.000Z',
    })

    const parsed = parseThemeNoteFile(content)

    expect(parsed.frontmatter.format).toBe(noteFileFormat)
    expect(parsed.frontmatter.themeSlug).toBe('tema-1')
    expect(parsed.frontmatter.themeTitle).toBe('Téma 1')
    expect(parsed.markdown).toBe('# Heading\\n\\nText')
  })

  test('rejects invalid frontmatter format', () => {
    expect(() =>
      parseThemeNoteFile(`---
format: wrong
themeSlug: a
themeTitle: b
imageStrategy: convex-storage-uri
---
`),
    ).toThrow('Neplatný formát súboru')
  })

  test('parses and resolves canonical storage image URIs', () => {
    const uri = 'convex://storage/image123?name=diagram.png'
    const parsed = parseStorageImageUri(uri)

    expect(parsed).toEqual({ storageId: 'image123', imageName: 'diagram.png' })
    expect(resolveMarkdownImageSrc(uri, { image123: 'https://example.com/image.png' })).toBe(
      'https://example.com/image.png',
    )
  })
})
