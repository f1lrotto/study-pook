import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

const progressStatus = v.union(
  v.literal('not_started'),
  v.literal('in_progress'),
  v.literal('reviewed'),
  v.literal('mastered'),
)

const noteTextRole = v.union(
  v.literal('paragraph'),
  v.literal('list_item'),
  v.literal('subheading'),
)

const themeNoteSource = v.union(
  v.literal('import_docx'),
  v.literal('user_edit'),
  v.literal('markdown_file_import'),
  v.literal('legacy_note_blocks'),
  v.literal('legacy_manual_html'),
  v.literal('empty'),
)

export default defineSchema({
  courses: defineTable({
    slug: v.string(),
    title: v.string(),
    order: v.number(),
  })
    .index('by_slug', ['slug'])
    .index('by_order', ['order']),

  themes: defineTable({
    courseId: v.id('courses'),
    slug: v.string(),
    normalizedTitle: v.string(),
    number: v.number(),
    title: v.string(),
    subthemes: v.array(v.string()),
    sourceText: v.string(),
    order: v.number(),
    manualNotesHtml: v.optional(v.string()),
    manualNotesUpdatedAt: v.optional(v.number()),
  })
    .index('by_slug', ['slug'])
    .index('by_normalized_title', ['normalizedTitle'])
    .index('by_course_order', ['courseId', 'order']),

  noteBlocks: defineTable({
    themeId: v.id('themes'),
    externalKey: v.string(),
    order: v.number(),
    kind: v.union(v.literal('text'), v.literal('image'), v.literal('table')),
    text: v.optional(v.string()),
    textRole: v.optional(noteTextRole),
    listLevel: v.optional(v.number()),
    richTextJson: v.optional(v.string()),
    imageStorageId: v.optional(v.id('_storage')),
    imageUrl: v.optional(v.string()),
    sourceImageName: v.optional(v.string()),
    userEditedAt: v.optional(v.number()),
  })
    .index('by_theme_order', ['themeId', 'order'])
    .index('by_theme_external_key', ['themeId', 'externalKey']),

  themeNotes: defineTable({
    themeId: v.id('themes'),
    markdown: v.string(),
    formatVersion: v.number(),
    source: themeNoteSource,
    storageImageIds: v.array(v.id('_storage')),
    createdAt: v.number(),
    updatedAt: v.number(),
    userEditedAt: v.optional(v.number()),
    lastImportedAt: v.optional(v.number()),
    lastImportKey: v.optional(v.string()),
    legacyMigratedAt: v.optional(v.number()),
    legacyDroppedImageCount: v.optional(v.number()),
  })
    .index('by_theme_id', ['themeId'])
    .index('by_updated_at', ['updatedAt']),

  progress: defineTable({
    userKey: v.string(),
    themeId: v.id('themes'),
    status: progressStatus,
    confidence: v.number(),
    confidenceMode: v.optional(v.union(v.literal('derived'), v.literal('manual'))),
    manualConfidence: v.optional(v.number()),
    subthemeConfidences: v.optional(v.array(v.number())),
    lastReviewedAt: v.optional(v.number()),
    reviewCount: v.number(),
  }).index('by_user_theme', ['userKey', 'themeId']),

  studyTotals: defineTable({
    userKey: v.string(),
    totalStudySeconds: v.number(),
    updatedAt: v.number(),
  }).index('by_user_key', ['userKey']),

  importRuns: defineTable({
    importKey: v.string(),
    status: v.union(v.literal('running'), v.literal('completed'), v.literal('failed')),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    stats: v.optional(v.string()),
  })
    .index('by_import_key', ['importKey'])
    .index('by_started_at', ['startedAt']),
})
