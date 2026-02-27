const droppedLegacyImageMessage = '[legacy embedded image dropped during migration]'
const droppedLegacyImageToken = 'LEGACYDROPPEDIMAGETOKEN'

const cleanLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const normalizeMarkdown = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const toStorageImageUri = (storageId: string, imageName?: string) => {
  const name = encodeURIComponent((imageName ?? 'image').trim() || 'image')
  return `convex://storage/${storageId}?name=${name}`
}

const storageImageIdPattern = /convex:\/\/storage\/([a-zA-Z0-9_-]+)/g

export const extractStorageImageIds = (markdown: string) => {
  const matches = [...markdown.matchAll(storageImageIdPattern)]
  return [...new Set(matches.map((match) => match[1]).filter(Boolean))]
}

export const hasMeaningfulMarkdown = (markdown: string) => {
  if (extractStorageImageIds(markdown).length) {
    return true
  }

  const plainText = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/^[\s>*#-]+/gm, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plainText.length > 0
}

type LegacyNoteBlock = {
  kind: 'text' | 'image' | 'table'
  text?: string
  textRole?: 'paragraph' | 'list_item' | 'subheading'
  listLevel?: number
  sourceImageName?: string
  externalKey?: string
  imageStorageId?: string
  order?: number
}

const renderTextBlock = (block: LegacyNoteBlock) => {
  const text = cleanLine(block.text ?? '')
  if (!text) {
    return ''
  }

  if (block.textRole === 'subheading') {
    return `### ${text}`
  }

  if (block.textRole === 'list_item') {
    const indent = '  '.repeat(Math.max(0, Math.floor(block.listLevel ?? 0)))
    return `${indent}- ${text}`
  }

  return text
}

const renderImageBlock = (block: LegacyNoteBlock) => {
  if (!block.imageStorageId) {
    const label = cleanLine(block.sourceImageName ?? block.externalKey ?? 'image')
    return `> [image unavailable: ${label}]`
  }

  const alt = cleanLine(block.sourceImageName ?? 'image')
  return `![${alt}](${toStorageImageUri(block.imageStorageId, alt)})`
}

const renderTableBlock = (block: LegacyNoteBlock) => {
  const text = (block.text ?? '').trim()
  if (!text) {
    return ''
  }

  return `\`\`\`text\n${text}\n\`\`\``
}

const renderLegacyBlock = (block: LegacyNoteBlock) => {
  if (block.kind === 'image') {
    return renderImageBlock(block)
  }

  if (block.kind === 'table') {
    return renderTableBlock(block)
  }

  return renderTextBlock(block)
}

export const noteBlocksToMarkdown = (blocks: LegacyNoteBlock[]) =>
  normalizeMarkdown(
    [...blocks]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map(renderLegacyBlock)
      .filter(Boolean)
      .join('\n\n'),
  )

const decodeHtmlEntities = (value: string) =>
  value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")

const stripHtml = (value: string) => decodeHtmlEntities(value.replace(/<[^>]*>/g, ' '))

const htmlToMarkdown = (html: string) => {
  const convertInline = (source: string) =>
    decodeHtmlEntities(source)
      .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
        const text = cleanLine(stripHtml(String(content)))
        return text ? `**${text}**` : ''
      })
      .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
        const text = cleanLine(stripHtml(String(content)))
        return text ? `*${text}*` : ''
      })
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?span[^>]*>/gi, '')

  let output = html
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
      const level = Number(String(tag).slice(1))
      const text = cleanLine(stripHtml(convertInline(String(content))))
      return text ? `\n${'#'.repeat(Math.max(1, level))} ${text}\n` : '\n'
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
      const text = cleanLine(stripHtml(convertInline(String(content))))
      return text ? `\n> ${text}\n` : '\n'
    })
    .replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
      const items = [...String(content).matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((match) => cleanLine(stripHtml(convertInline(match[1]))))
        .filter(Boolean)
      return items.length ? `\n${items.map((item) => `- ${item}`).join('\n')}\n` : '\n'
    })
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, content) => {
      const text = decodeHtmlEntities(String(content)).replace(/^\s+|\s+$/g, '')
      return text ? `\n\`\`\`text\n${text}\n\`\`\`\n` : '\n'
    })
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => {
      const text = cleanLine(stripHtml(convertInline(String(content))))
      return text ? `\n${text}\n` : '\n'
    })
    .replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, (_, content) => {
      const text = cleanLine(stripHtml(convertInline(String(content))))
      return text ? `\n${text}\n` : '\n'
    })
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const alt = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)
      const imageSrc = src?.[1] ?? src?.[2] ?? src?.[3] ?? ''
      const imageAlt = cleanLine(decodeHtmlEntities(alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? 'image'))
      return imageSrc ? `\n![${imageAlt || 'image'}](${imageSrc})\n` : '\n'
    })

  output = convertInline(output)
  output = decodeHtmlEntities(output)
  output = output.replace(/<[^>]*>/g, '\n')

  return normalizeMarkdown(output)
}

export const legacyManualHtmlToMarkdown = (html: string, dropLegacyDataUrlImages: boolean) => {
  const rawHtml = html.trim()
  if (!rawHtml) {
    return {
      markdown: '',
      droppedImageCount: 0,
    }
  }

  let droppedImageCount = 0

  const sanitizedHtml = dropLegacyDataUrlImages
    ? rawHtml.replace(
        /<img\b[^>]*\bsrc\s*=\s*(?:"data:[^"]*"|'data:[^']*'|data:[^\s>]+)[^>]*>/gi,
        () => {
          droppedImageCount += 1
          return `<p>${droppedLegacyImageToken}</p>`
        },
      )
    : rawHtml

  const markdown = htmlToMarkdown(sanitizedHtml)
    .split('\n')
    .map((line: string) =>
      line.includes(droppedLegacyImageToken)
        ? `> ${droppedLegacyImageMessage}`
        : line.replaceAll(droppedLegacyImageToken, droppedLegacyImageMessage),
    )
    .join('\n')

  return {
    markdown: normalizeMarkdown(markdown),
    droppedImageCount,
  }
}

export const markdownToStorageImageMap = async (
  markdown: string,
  resolveUrl: (storageId: string) => Promise<string | null>,
) => {
  const ids = extractStorageImageIds(markdown)
  const entries = await Promise.all(
    ids.map(async (id) => {
      const url = await resolveUrl(id)
      return [id, url] as const
    }),
  )

  return Object.fromEntries(entries.filter((entry): entry is [string, string] => Boolean(entry[1])))
}
