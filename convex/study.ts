import { ConvexError, v } from 'convex/values'

import { mutation, query, type MutationCtx, type QueryCtx } from './_generated/server'

const progressStatusValues = ['not_started', 'in_progress', 'reviewed', 'mastered'] as const

const progressStatusValidator = v.union(
  v.literal('not_started'),
  v.literal('in_progress'),
  v.literal('reviewed'),
  v.literal('mastered'),
)

const noteTextRoleValidator = v.union(
  v.literal('paragraph'),
  v.literal('list_item'),
  v.literal('subheading'),
)

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const clampConfidence = (confidence: number) => Math.max(0, Math.min(5, Math.round(confidence)))
const sumStudyTotalSeconds = (
  rows: Array<{
    totalStudySeconds: number
  }>,
) => rows.reduce((sum, row) => sum + row.totalStudySeconds, 0)

const parseStats = (stats?: string) => {
  if (!stats) {
    return null
  }

  try {
    return JSON.parse(stats)
  } catch {
    return null
  }
}

const buildCourseStats = async (ctx: QueryCtx, userKey?: string) => {
  const courses = (await ctx.db.query('courses').collect()).sort((a, b) => a.order - b.order)
  const themes = await ctx.db.query('themes').collect()

  const themesByCourse = themes.reduce((acc, theme) => {
    const next = acc.get(theme.courseId) ?? []
    next.push(theme)
    acc.set(theme.courseId, next)
    return acc
  }, new Map<string, typeof themes>())

  const progressMap = userKey ? await firstProgressByTheme(ctx, userKey) : new Map()

  return courses.map((course) => {
    const courseThemes = (themesByCourse.get(course._id) ?? []).sort((a, b) => a.order - b.order)
    const themeCount = courseThemes.length

    const stats = courseThemes.reduce(
      (acc, theme) => {
        const progress = progressMap.get(theme._id)

        if (!progress) {
          return acc
        }

        if (progress.status === 'reviewed' || progress.status === 'mastered') {
          acc.completed += 1
        }

        if (progress.status === 'mastered') {
          acc.mastered += 1
        }

        acc.confidence += progress.confidence
        acc.withProgress += 1

        return acc
      },
      { completed: 0, mastered: 0, confidence: 0, withProgress: 0 },
    )

    return {
      ...course,
      themeCount,
      completedCount: stats.completed,
      masteredCount: stats.mastered,
      completion: themeCount ? stats.completed / themeCount : 0,
      averageConfidence: stats.withProgress ? stats.confidence / stats.withProgress : 0,
    }
  })
}

const firstProgressByTheme = async (ctx: QueryCtx | MutationCtx, userKey: string) => {
  const progressRows = await ctx.db
    .query('progress')
    .withIndex('by_user_theme', (q) => q.eq('userKey', userKey))
    .collect()

  return new Map(progressRows.map((row) => [row.themeId, row]))
}

const ensureThemeExists = async (ctx: MutationCtx, themeId: string) => {
  const theme = await ctx.db.get(themeId as never)
  if (!theme || !('title' in theme)) {
    throw new ConvexError('Neplatná téma')
  }
}

const removeThemeData = async (ctx: MutationCtx, themeId: string) => {
  const noteBlocks = await ctx.db
    .query('noteBlocks')
    .withIndex('by_theme_order', (q) => q.eq('themeId', themeId as never))
    .collect()

  for (const block of noteBlocks) {
    await ctx.db.delete(block._id)
  }

  const progress = await ctx.db.query('progress').collect()
  for (const row of progress.filter((row) => row.themeId === themeId)) {
    await ctx.db.delete(row._id)
  }
}

const scoreNameMatch = (a: string, b: string) => {
  if (a === b) {
    return 1
  }

  const aTokens = new Set(a.split(' ').filter(Boolean))
  const bTokens = new Set(b.split(' ').filter(Boolean))

  if (!aTokens.size || !bTokens.size) {
    return 0
  }

  const common = [...aTokens].filter((token) => bTokens.has(token)).length
  return common / Math.max(aTokens.size, bTokens.size)
}

export const listCourses = query({
  args: {
    userKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => buildCourseStats(ctx, args.userKey),
})

export const listThemes = query({
  args: {
    courseId: v.optional(v.id('courses')),
    userKey: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const allThemes = args.courseId
      ? await ctx.db
          .query('themes')
          .withIndex('by_course_order', (q) => q.eq('courseId', args.courseId as never))
          .collect()
      : await ctx.db.query('themes').collect()

    const normalizedSearch = args.search ? normalizeText(args.search) : null

    const filteredThemes = normalizedSearch
      ? allThemes.filter((theme) => theme.normalizedTitle.includes(normalizedSearch))
      : allThemes

    const courses = await ctx.db.query('courses').collect()
    const courseById = new Map(courses.map((course) => [course._id, course]))
    const noteBlocks = await ctx.db.query('noteBlocks').collect()
    const themesWithStudyNotes = new Set(noteBlocks.map((block) => block.themeId))
    const themesWithEditedImportedNotes = new Set(
      noteBlocks.filter((block) => Boolean(block.userEditedAt)).map((block) => block.themeId),
    )

    const progressMap = args.userKey ? await firstProgressByTheme(ctx, args.userKey) : new Map()

    return filteredThemes
      .sort((a, b) => a.order - b.order)
      .map((theme) => ({
        ...theme,
        course: courseById.get(theme.courseId),
        progress: progressMap.get(theme._id) ?? null,
        hasStudyNotes: themesWithStudyNotes.has(theme._id),
        hasUserEditedNotes:
          themesWithEditedImportedNotes.has(theme._id) || Boolean(theme.manualNotesUpdatedAt),
      }))
  },
})

export const getTheme = query({
  args: {
    themeId: v.id('themes'),
    userKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const theme = await ctx.db.get(args.themeId)
    if (!theme) {
      return null
    }

    const course = await ctx.db.get(theme.courseId)

    const progress = args.userKey
      ? await ctx.db
          .query('progress')
          .withIndex('by_user_theme', (q) =>
            q.eq('userKey', args.userKey as never).eq('themeId', theme._id),
          )
          .first()
      : null

    const noteBlocks = await ctx.db
      .query('noteBlocks')
      .withIndex('by_theme_order', (q) => q.eq('themeId', theme._id))
      .collect()

    const hydratedBlocks = await Promise.all(
      noteBlocks.map(async (block) => {
        if (block.kind !== 'image' || !block.imageStorageId) {
          return block
        }

        const imageUrl =
          block.imageUrl ?? (await ctx.storage.getUrl(block.imageStorageId)) ?? undefined
        return {
          ...block,
          imageUrl,
        }
      }),
    )

    return {
      theme,
      course,
      progress,
      noteBlocks: hydratedBlocks.sort((a, b) => a.order - b.order),
    }
  },
})

export const getDashboard = query({
  args: {
    userKey: v.string(),
  },
  handler: async (ctx, args) => {
    const courses = await buildCourseStats(ctx, args.userKey)
    const themes = await ctx.db.query('themes').collect()
    const progressMap = await firstProgressByTheme(ctx, args.userKey)

    const totals = themes.reduce(
      (acc, theme) => {
        const progress = progressMap.get(theme._id)

        if (!progress) {
          acc.notStarted += 1
          return acc
        }

        if (progress.status === 'not_started') {
          acc.notStarted += 1
        }

        if (progress.status === 'in_progress') {
          acc.inProgress += 1
        }

        if (progress.status === 'reviewed') {
          acc.reviewed += 1
        }

        if (progress.status === 'mastered') {
          acc.mastered += 1
        }

        return acc
      },
      { notStarted: 0, inProgress: 0, reviewed: 0, mastered: 0 },
    )

    return {
      courses,
      totals,
      themeCount: themes.length,
    }
  },
})

export const getStudyTotal = query({
  args: {
    userKey: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('studyTotals')
      .withIndex('by_user_key', (q) => q.eq('userKey', args.userKey))
      .first()

    if (row) {
      return {
        totalStudySeconds: row.totalStudySeconds,
        updatedAt: row.updatedAt ?? null,
      }
    }

    const legacyRows = await ctx.db.query('studyTotals').collect()
    return {
      totalStudySeconds: sumStudyTotalSeconds(legacyRows),
      updatedAt: legacyRows.length ? Math.max(...legacyRows.map((entry) => entry.updatedAt)) : null,
    }
  },
})

export const addStudySeconds = mutation({
  args: {
    userKey: v.string(),
    seconds: v.number(),
  },
  handler: async (ctx, args) => {
    const seconds = Math.max(0, Math.floor(args.seconds))
    const now = Date.now()

    const existing = await ctx.db
      .query('studyTotals')
      .withIndex('by_user_key', (q) => q.eq('userKey', args.userKey))
      .first()

    if (!seconds) {
      return {
        totalStudySeconds: existing?.totalStudySeconds ?? 0,
      }
    }

    if (existing) {
      const totalStudySeconds = existing.totalStudySeconds + seconds
      await ctx.db.patch(existing._id, {
        totalStudySeconds,
        updatedAt: now,
      })

      return {
        totalStudySeconds,
      }
    }

    const legacyRows = await ctx.db.query('studyTotals').collect()
    const mergedBase = sumStudyTotalSeconds(legacyRows)
    const totalStudySeconds = mergedBase + seconds

    await ctx.db.insert('studyTotals', {
      userKey: args.userKey,
      totalStudySeconds,
      updatedAt: now,
    })

    for (const row of legacyRows) {
      await ctx.db.delete(row._id)
    }

    return {
      totalStudySeconds,
    }
  },
})

export const listImportRuns = query({
  args: {},
  handler: async (ctx) => {
    const runs = await ctx.db.query('importRuns').collect()
    return runs
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 20)
      .map((run) => ({
        ...run,
        parsedStats: parseStats(run.stats),
      }))
  },
})

export const setThemeProgress = mutation({
  args: {
    userKey: v.string(),
    themeId: v.id('themes'),
    status: progressStatusValidator,
    confidence: v.number(),
    confidenceMode: v.optional(v.union(v.literal('derived'), v.literal('manual'))),
    manualConfidence: v.optional(v.number()),
    subthemeConfidences: v.optional(v.array(v.number())),
  },
  handler: async (ctx, args) => {
    await ensureThemeExists(ctx, args.themeId)
    const theme = await ctx.db.get(args.themeId)
    if (!theme) {
      throw new ConvexError('Neplatná téma')
    }

    const reviewIncrement = args.status === 'reviewed' || args.status === 'mastered' ? 1 : 0

    const existing = await ctx.db
      .query('progress')
      .withIndex('by_user_theme', (q) =>
        q.eq('userKey', args.userKey as never).eq('themeId', args.themeId),
      )
      .first()

    const subthemeCount = theme.subthemes.length
    const baseSubthemeConfidences =
      args.subthemeConfidences ?? existing?.subthemeConfidences ?? Array(subthemeCount).fill(0)
    const subthemeConfidences = Array.from({ length: subthemeCount }, (_, index) =>
      clampConfidence(baseSubthemeConfidences[index] ?? 0),
    )

    const averageSubthemeConfidence = subthemeCount
      ? clampConfidence(
          subthemeConfidences.reduce((sum, value) => sum + value, 0) / Math.max(1, subthemeCount),
        )
      : undefined

    const manualConfidence =
      args.manualConfidence !== undefined
        ? clampConfidence(args.manualConfidence)
        : existing?.manualConfidence !== undefined
          ? clampConfidence(existing.manualConfidence)
          : clampConfidence(args.confidence)

    const requestedMode: 'derived' | 'manual' =
      args.confidenceMode ?? existing?.confidenceMode ?? 'manual'
    const confidenceMode: 'derived' | 'manual' =
      requestedMode === 'derived' && averageSubthemeConfidence !== undefined ? 'derived' : 'manual'

    const confidence =
      confidenceMode === 'derived' && averageSubthemeConfidence !== undefined
        ? averageSubthemeConfidence
        : manualConfidence

    const patch = {
      userKey: args.userKey,
      themeId: args.themeId,
      status: args.status,
      confidence,
      confidenceMode,
      manualConfidence,
      subthemeConfidences,
      lastReviewedAt:
        args.status === 'reviewed' || args.status === 'mastered'
          ? Date.now()
          : existing?.lastReviewedAt,
      reviewCount: (existing?.reviewCount ?? 0) + reviewIncrement,
    }

    if (existing) {
      await ctx.db.patch(existing._id, patch)
      return await ctx.db.get(existing._id)
    }

    const insertedId = await ctx.db.insert('progress', patch)
    return await ctx.db.get(insertedId)
  },
})

const sanitizeTitle = (value: string, fieldName: string) => {
  const title = value.trim().replace(/\s+/g, ' ')
  if (!title) {
    throw new ConvexError(`${fieldName} nemôže byť prázdny`)
  }

  return title
}

const hasMeaningfulManualNotes = (html: string) => {
  if (/<img[\s>]/i.test(html)) {
    return true
  }

  return html
    .replace(/<p>\s*<\/p>/gi, ' ')
    .replace(/<p>\s*<br\s*\/?>\s*<\/p>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length
    ? true
    : false
}

export const updateCourseTitle = mutation({
  args: {
    courseId: v.id('courses'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const course = await ctx.db.get(args.courseId)
    if (!course) {
      throw new ConvexError('Kurz neexistuje')
    }

    const title = sanitizeTitle(args.title, 'Názov kurzu')
    await ctx.db.patch(args.courseId, { title })
    return await ctx.db.get(args.courseId)
  },
})

export const updateThemeTitle = mutation({
  args: {
    themeId: v.id('themes'),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureThemeExists(ctx, args.themeId)

    const title = sanitizeTitle(args.title, 'Názov témy')
    await ctx.db.patch(args.themeId, {
      title,
      normalizedTitle: normalizeText(title),
    })

    return await ctx.db.get(args.themeId)
  },
})

export const updateThemeSubthemes = mutation({
  args: {
    themeId: v.id('themes'),
    subthemes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ensureThemeExists(ctx, args.themeId)

    const subthemes = args.subthemes.map((item) => item.trim().replace(/\s+/g, ' ')).filter(Boolean)

    await ctx.db.patch(args.themeId, { subthemes })
    return await ctx.db.get(args.themeId)
  },
})

export const updateNoteBlockText = mutation({
  args: {
    blockId: v.id('noteBlocks'),
    text: v.string(),
    richTextJson: v.optional(v.string()),
    textRole: v.optional(noteTextRoleValidator),
    listLevel: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const block = await ctx.db.get(args.blockId)
    if (!block) {
      throw new ConvexError('Poznámka neexistuje')
    }

    if (block.kind === 'image') {
      throw new ConvexError('Obrázky nie je možné upravovať ako text')
    }

    if (block.kind === 'table') {
      const text = args.text.trim()
      if (!text) {
        throw new ConvexError('Text poznámky nemôže byť prázdny')
      }

      await ctx.db.patch(args.blockId, { text, userEditedAt: Date.now() })
      return await ctx.db.get(args.blockId)
    }

    const text = sanitizeTitle(args.text, 'Text poznámky')
    const textRole = args.textRole ?? block.textRole ?? 'paragraph'
    const listLevel =
      textRole === 'paragraph'
        ? undefined
        : args.listLevel !== undefined
          ? Math.max(0, Math.floor(args.listLevel))
          : block.listLevel

    let richTextJson = args.richTextJson

    if (!richTextJson) {
      richTextJson = JSON.stringify([
        {
          text,
          bold: textRole === 'subheading',
        },
      ])
    }

    await ctx.db.patch(args.blockId, {
      text,
      richTextJson,
      textRole,
      listLevel,
      userEditedAt: Date.now(),
    })

    return await ctx.db.get(args.blockId)
  },
})

export const saveThemeManualNotes = mutation({
  args: {
    themeId: v.id('themes'),
    html: v.string(),
  },
  handler: async (ctx, args) => {
    await ensureThemeExists(ctx, args.themeId)

    const html = args.html.trim()

    if (!hasMeaningfulManualNotes(html)) {
      await ctx.db.patch(args.themeId, {
        manualNotesHtml: undefined,
        manualNotesUpdatedAt: undefined,
      })

      return await ctx.db.get(args.themeId)
    }

    await ctx.db.patch(args.themeId, {
      manualNotesHtml: html,
      manualNotesUpdatedAt: Date.now(),
    })

    return await ctx.db.get(args.themeId)
  },
})

export const spinTheme = mutation({
  args: {
    userKey: v.string(),
    courseId: v.optional(v.id('courses')),
    statuses: v.optional(v.array(progressStatusValidator)),
    maxConfidence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const themes = args.courseId
      ? await ctx.db
          .query('themes')
          .withIndex('by_course_order', (q) => q.eq('courseId', args.courseId as never))
          .collect()
      : await ctx.db.query('themes').collect()

    const progressMap = await firstProgressByTheme(ctx, args.userKey)
    const now = Date.now()

    const candidates = themes.filter((theme) => {
      const progress = progressMap.get(theme._id)

      if (args.statuses?.length) {
        const status = progress?.status ?? 'not_started'
        if (!args.statuses.includes(status)) {
          return false
        }
      }

      if (args.maxConfidence !== undefined) {
        const confidence = progress?.confidence ?? 0
        if (confidence > args.maxConfidence) {
          return false
        }
      }

      return true
    })

    if (!candidates.length) {
      return null
    }

    const weighted = candidates.map((theme) => {
      const progress = progressMap.get(theme._id)
      const unseenBoost = progress ? 1 : 3
      const confidenceBoost = 1 + (5 - (progress?.confidence ?? 0)) * 0.35
      const daysSinceReview = progress?.lastReviewedAt
        ? (now - progress.lastReviewedAt) / (1000 * 60 * 60 * 24)
        : 30
      const stalenessBoost = Math.min(2, 1 + daysSinceReview / 14)
      const weight = 1 * unseenBoost * confidenceBoost * stalenessBoost

      return {
        theme,
        progress,
        weight,
      }
    })

    const total = weighted.reduce((acc, item) => acc + item.weight, 0)
    let threshold = Math.random() * total

    const selected =
      weighted.find((item) => {
        threshold -= item.weight
        return threshold <= 0
      }) ?? weighted[weighted.length - 1]

    const course = await ctx.db.get(selected.theme.courseId)

    return {
      ...selected,
      course,
    }
  },
})

const curriculumThemeValidator = v.object({
  slug: v.string(),
  normalizedTitle: v.string(),
  number: v.number(),
  title: v.string(),
  subthemes: v.array(v.string()),
  sourceText: v.string(),
  order: v.number(),
})

const curriculumCourseValidator = v.object({
  slug: v.string(),
  title: v.string(),
  order: v.number(),
  themes: v.array(curriculumThemeValidator),
})

export const beginImportRun = mutation({
  args: {
    importKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query('importRuns')
      .withIndex('by_import_key', (q) => q.eq('importKey', args.importKey))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'running',
        startedAt: now,
        finishedAt: undefined,
        stats: undefined,
      })

      return existing._id
    }

    return await ctx.db.insert('importRuns', {
      importKey: args.importKey,
      status: 'running',
      startedAt: now,
    })
  },
})

export const finishImportRun = mutation({
  args: {
    importKey: v.string(),
    status: v.union(v.literal('completed'), v.literal('failed')),
    stats: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('importRuns')
      .withIndex('by_import_key', (q) => q.eq('importKey', args.importKey))
      .first()

    if (!existing) {
      return null
    }

    await ctx.db.patch(existing._id, {
      status: args.status,
      finishedAt: Date.now(),
      stats: args.stats,
    })

    return await ctx.db.get(existing._id)
  },
})

export const importCurriculum = mutation({
  args: {
    importKey: v.string(),
    courses: v.array(curriculumCourseValidator),
  },
  handler: async (ctx, args) => {
    const existingCourses = await ctx.db.query('courses').collect()
    const existingThemes = await ctx.db.query('themes').collect()

    const incomingCourseSlugs = new Set(args.courses.map((course) => course.slug))
    const incomingThemeSlugs = new Set(
      args.courses.flatMap((course) => course.themes.map((theme) => theme.slug)),
    )

    const courseBySlug = new Map(existingCourses.map((course) => [course.slug, course]))
    const themeBySlug = new Map(existingThemes.map((theme) => [theme.slug, theme]))

    const courseIdBySlug = new Map<string, string>()

    for (const course of args.courses) {
      const existing = courseBySlug.get(course.slug)

      if (existing) {
        await ctx.db.patch(existing._id, {
          title: course.title,
          order: course.order,
        })
        courseIdBySlug.set(course.slug, existing._id)
      } else {
        const insertedId = await ctx.db.insert('courses', {
          slug: course.slug,
          title: course.title,
          order: course.order,
        })
        courseIdBySlug.set(course.slug, insertedId)
      }
    }

    for (const course of args.courses) {
      const courseId = courseIdBySlug.get(course.slug)
      if (!courseId) {
        continue
      }

      for (const theme of course.themes) {
        const existing = themeBySlug.get(theme.slug)
        const patch = {
          courseId: courseId as never,
          slug: theme.slug,
          normalizedTitle: theme.normalizedTitle,
          number: theme.number,
          title: theme.title,
          subthemes: theme.subthemes,
          sourceText: theme.sourceText,
          order: theme.order,
        }

        if (existing) {
          await ctx.db.patch(existing._id, patch)
        } else {
          await ctx.db.insert('themes', patch)
        }
      }
    }

    for (const theme of existingThemes) {
      if (incomingThemeSlugs.has(theme.slug)) {
        continue
      }

      await removeThemeData(ctx, theme._id)
      await ctx.db.delete(theme._id)
    }

    for (const course of existingCourses) {
      if (incomingCourseSlugs.has(course.slug)) {
        continue
      }

      await ctx.db.delete(course._id)
    }

    const refreshedThemes = await ctx.db.query('themes').collect()

    return {
      importKey: args.importKey,
      courses: args.courses.length,
      themes: refreshedThemes.length,
      themeLookup: refreshedThemes.map((theme) => ({
        id: theme._id,
        slug: theme.slug,
        title: theme.title,
        normalizedTitle: theme.normalizedTitle,
      })),
    }
  },
})

const noteBlockValidator = v.object({
  externalKey: v.string(),
  order: v.number(),
  kind: v.union(v.literal('text'), v.literal('image'), v.literal('table')),
  text: v.optional(v.string()),
  textRole: v.optional(noteTextRoleValidator),
  listLevel: v.optional(v.number()),
  richTextJson: v.optional(v.string()),
  imageStorageId: v.optional(v.id('_storage')),
  sourceImageName: v.optional(v.string()),
})

export const replaceThemeNoteBlocks = mutation({
  args: {
    themeId: v.id('themes'),
    blocks: v.array(noteBlockValidator),
  },
  handler: async (ctx, args) => {
    await ensureThemeExists(ctx, args.themeId)

    const existing = await ctx.db
      .query('noteBlocks')
      .withIndex('by_theme_order', (q) => q.eq('themeId', args.themeId as never))
      .collect()

    const existingByExternalKey = new Map(existing.map((block) => [block.externalKey, block]))
    const seen = new Set<string>()

    for (const block of args.blocks) {
      const existingBlock = existingByExternalKey.get(block.externalKey)
      const imageUrl = block.imageStorageId
        ? await ctx.storage.getUrl(block.imageStorageId)
        : undefined

      const patch = {
        themeId: args.themeId,
        externalKey: block.externalKey,
        order: block.order,
        kind: block.kind,
        text: block.text,
        textRole: block.textRole,
        listLevel: block.listLevel,
        richTextJson: block.richTextJson,
        imageStorageId: block.imageStorageId,
        imageUrl: imageUrl ?? undefined,
        sourceImageName: block.sourceImageName,
        userEditedAt: undefined,
      }

      if (existingBlock) {
        await ctx.db.patch(existingBlock._id, patch)
      } else {
        await ctx.db.insert('noteBlocks', patch)
      }

      seen.add(block.externalKey)
    }

    for (const stale of existing) {
      if (seen.has(stale.externalKey)) {
        continue
      }

      await ctx.db.delete(stale._id)
    }

    return {
      themeId: args.themeId,
      count: args.blocks.length,
    }
  },
})

export const getUploadUrl = mutation({
  args: {},
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
})

export const resolveThemeByHeading = query({
  args: {
    heading: v.string(),
  },
  handler: async (ctx, args) => {
    const normalizedHeading = normalizeText(args.heading)
    const themes = await ctx.db.query('themes').collect()

    const exact = themes.find((theme) => theme.normalizedTitle === normalizedHeading)
    if (exact) {
      return exact
    }

    const best = themes
      .map((theme) => ({
        theme,
        score: scoreNameMatch(theme.normalizedTitle, normalizedHeading),
      }))
      .sort((a, b) => b.score - a.score)[0]

    if (!best || best.score < 0.55) {
      return null
    }

    return best.theme
  },
})

export const metadata = query({
  args: {},
  handler: async () => ({
    progressStatuses: progressStatusValues,
  }),
})
