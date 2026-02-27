import { describe, expect, test } from 'vitest'

import {
  extractStorageImageIds,
  legacyManualHtmlToMarkdown,
  noteBlocksToMarkdown,
  toStorageImageUri,
} from '../../convex/noteMarkdown'

describe('noteMarkdown', () => {
  test('converts mixed legacy note blocks to markdown', () => {
    const markdown = noteBlocksToMarkdown([
      {
        kind: 'text',
        order: 1,
        textRole: 'subheading',
        text: 'Overview',
      },
      {
        kind: 'text',
        order: 2,
        textRole: 'paragraph',
        text: 'Main paragraph',
      },
      {
        kind: 'text',
        order: 3,
        textRole: 'list_item',
        listLevel: 1,
        text: 'Nested bullet',
      },
      {
        kind: 'image',
        order: 4,
        sourceImageName: 'diagram.png',
        imageStorageId: 'storage123',
      },
      {
        kind: 'table',
        order: 5,
        text: 'cell A\\ncell B',
      },
    ])

    expect(markdown).toContain('### Overview')
    expect(markdown).toContain('Main paragraph')
    expect(markdown).toContain('  - Nested bullet')
    expect(markdown).toContain(`![diagram.png](${toStorageImageUri('storage123', 'diagram.png')})`)
    expect(markdown).toContain('```text')
    expect(markdown).toContain('cell A\\ncell B')
  })

  test('replaces dropped legacy data-url images with explicit marker', () => {
    const result = legacyManualHtmlToMarkdown(
      '<h3>Manual</h3><p>Text</p><img src="data:image/png;base64,AAA" />',
      true,
    )

    expect(result.droppedImageCount).toBe(1)
    expect(result.markdown).toContain('### Manual')
    expect(result.markdown).toContain('Text')
    expect(result.markdown).toContain('> [legacy embedded image dropped during migration]')
  })

  test('extracts unique storage ids from markdown image links', () => {
    const markdown = [
      `![a](${toStorageImageUri('img-1', 'a.png')})`,
      `![b](${toStorageImageUri('img-2', 'b.png')})`,
      `![again](${toStorageImageUri('img-1', 'a2.png')})`,
    ].join('\\n')

    expect(extractStorageImageIds(markdown)).toEqual(['img-1', 'img-2'])
  })
})
