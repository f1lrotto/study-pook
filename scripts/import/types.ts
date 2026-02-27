export type ParsedTheme = {
  slug: string
  normalizedTitle: string
  number: number
  title: string
  subthemes: string[]
  sourceText: string
  order: number
}

export type ParsedCourse = {
  slug: string
  title: string
  order: number
  themes: ParsedTheme[]
}

export type ParsedCurriculum = {
  courses: ParsedCourse[]
}

export type ThemeLookup = {
  id: string
  slug: string
  title: string
  normalizedTitle: string
}

export type ParsedNoteBlock = {
  externalKey: string
  order: number
  kind: 'text' | 'image' | 'table'
  text?: string
  textRole?: 'paragraph' | 'list_item' | 'subheading'
  listLevel?: number
  richTextJson?: string
  sourceImageName?: string
  imageTarget?: string
}

export type ParsedDocxNotes = {
  blocksByTheme: Map<string, ParsedNoteBlock[]>
  imageBytesByTarget: Map<string, Uint8Array>
  unmatchedHeadings: string[]
}
