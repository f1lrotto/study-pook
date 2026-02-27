import { ConvexHttpClient } from 'convex/browser'

import { api } from '../convex/_generated/api'

const convexUrl = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error('Missing CONVEX_URL or VITE_CONVEX_URL environment variable.')
}

const parsePositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const keepLegacyDataUrlImages = args.includes('--keep-legacy-data-url-images')
const batchSizeArg = args.find((arg) => arg.startsWith('--batch='))?.split('=')[1]
const batchSize = parsePositiveInt(batchSizeArg, 50)

const client = new ConvexHttpClient(convexUrl)

const run = async () => {
  let cursor = 0
  let batch = 0
  let created = 0
  let updated = 0
  let skippedExisting = 0

  for (;;) {
    batch += 1

    const result = await client.mutation(api.study.migrateThemeNotesBatch, {
      cursor,
      limit: batchSize,
      dropLegacyDataUrlImages: !keepLegacyDataUrlImages,
      force,
    })

    created += result.created
    updated += result.updated
    skippedExisting += result.skippedExisting

    console.log(
      `Batch ${batch}: processed=${result.processed} created=${result.created} updated=${result.updated} skipped=${result.skippedExisting}`,
    )

    if (result.done || result.nextCursor === null) {
      break
    }

    cursor = result.nextCursor
  }

  const status = await client.query(api.study.notesMigrationStatus, {})

  console.log('Migration complete.')
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped existing: ${skippedExisting}`)
  console.log(
    `Status: themes=${status.themeCount} notes=${status.themeNoteCount} missing=${status.missingThemeNotes}`,
  )
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
