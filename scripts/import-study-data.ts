import { basename, join } from 'node:path'

import { ConvexHttpClient } from 'convex/browser'

import { api } from '../convex/_generated/api'
import { noteBlocksToMarkdown } from '../convex/noteMarkdown'
import { extractNotesFromDocx } from './import/parseDocx'
import { extractCurriculumFromPdf } from './import/parsePdf'

const rootDir = process.cwd()
const rawPdfPath = join(rootDir, 'raw', 'dav-okruhy-2026.pdf')
const rawDocxPath = join(rootDir, 'raw', 'okruhy.docx')

const importKey = `dav-2026-${new Date().toISOString().slice(0, 10)}`

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error('Missing CONVEX_URL or VITE_CONVEX_URL environment variable.')
}

const client = new ConvexHttpClient(convexUrl)

const uploadImage = async (bytes: Uint8Array, filename: string) => {
  const uploadUrl = await client.mutation(api.study.getUploadUrl, {})

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Filename': filename,
    },
    body: bytes,
  })

  if (!response.ok) {
    throw new Error(`Upload failed for ${filename}. ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as { storageId?: string }

  if (!payload.storageId) {
    throw new Error(`Missing storageId for ${filename}.`)
  }

  return payload.storageId
}

const run = async () => {
  const startedAt = Date.now()

  await client.mutation(api.study.beginImportRun, {
    importKey,
  })

  try {
    console.log('1/4 Parsing curriculum PDF...')
    const curriculum = extractCurriculumFromPdf(rawPdfPath)

    console.log(
      `   Parsed ${curriculum.courses.length} courses and ${curriculum.courses.reduce((sum, c) => sum + c.themes.length, 0)} themes.`,
    )

    console.log('2/4 Upserting curriculum...')
    const curriculumResult = await client.mutation(api.study.importCurriculum, {
      importKey,
      courses: curriculum.courses,
    })

    console.log('3/4 Parsing DOCX notes in original order...')
    const notes = await extractNotesFromDocx(rawDocxPath, curriculumResult.themeLookup)

    const allImageTargets = [...notes.imageBytesByTarget.keys()]
    console.log(
      `   Parsed ${notes.blocksByTheme.size} themed note streams with ${allImageTargets.length} distinct images.`,
    )

    if (notes.unmatchedHeadings.length) {
      console.log(`   Unmatched headings (${notes.unmatchedHeadings.length}):`)
      for (const heading of notes.unmatchedHeadings.slice(0, 25)) {
        console.log(`   - ${heading}`)
      }
    }

    console.log('4/4 Uploading images + replacing note blocks...')
    const imageStorageIds = new Map<string, string>()

    for (const [index, target] of allImageTargets.entries()) {
      const bytes = notes.imageBytesByTarget.get(target)
      if (!bytes) {
        continue
      }

      const name = basename(target)
      const storageId = await uploadImage(bytes, name)
      imageStorageIds.set(target, storageId)

      if ((index + 1) % 25 === 0 || index + 1 === allImageTargets.length) {
        console.log(`   Uploaded ${index + 1}/${allImageTargets.length} images`)
      }
    }

    let totalBlocks = 0
    let notesUpdated = 0
    let notesSkippedEdited = 0

    for (const [themeId, blocks] of notes.blocksByTheme.entries()) {
      const blocksWithStorage = blocks.map((block) => ({
        kind: block.kind,
        order: block.order,
        text: block.text,
        textRole: block.textRole,
        listLevel: block.listLevel,
        sourceImageName: block.sourceImageName,
        externalKey: block.externalKey,
        imageStorageId: block.imageTarget ? imageStorageIds.get(block.imageTarget) : undefined,
      }))

      const markdown = noteBlocksToMarkdown(blocksWithStorage)
      const storageImageIds = blocksWithStorage
        .map((block) => block.imageStorageId ?? null)
        .filter((id): id is string => Boolean(id))

      const result = await client.mutation(api.study.replaceThemeNoteFromDocx, {
        themeId: themeId as never,
        importKey,
        markdown,
        storageImageIds: storageImageIds as never[],
      })

      totalBlocks += blocks.length
      notesUpdated += result.updated ? 1 : 0
      notesSkippedEdited += result.skippedEdited ? 1 : 0
    }

    console.log(`   Parsed ${totalBlocks} note blocks into markdown notes.`)
    console.log(`   Theme notes updated: ${notesUpdated}, skipped edited: ${notesSkippedEdited}.`)

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)

    await client.mutation(api.study.finishImportRun, {
      importKey,
      status: 'completed',
      stats: JSON.stringify({
        courses: curriculum.courses.length,
        themes: curriculumResult.themes,
        noteThemes: notes.blocksByTheme.size,
        noteBlocksParsed: totalBlocks,
        notesUpdated,
        notesSkippedEdited,
        uploadedImages: imageStorageIds.size,
        elapsedSec,
      }),
    })

    console.log('Import done.')
  } catch (error) {
    await client.mutation(api.study.finishImportRun, {
      importKey,
      status: 'failed',
      stats: JSON.stringify({
        message: error instanceof Error ? error.message : String(error),
      }),
    })

    throw error
  }
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
