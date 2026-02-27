import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import type { ParsedCurriculum } from './types'
import { cleanLine, normalizeText, slugify } from './utils'

const knownCourseTitles = [
  'Diskrétna matematika',
  'Matematická analýza',
  'Algebra',
  'Pravdepodobnosť a štatistika',
  'Tvorba a analýza algoritmov a dátových štruktúr',
  'Lineárne programovanie a metódy voľnej optimalizácie',
  'Databázy',
  'Princípy dátovej vedy',
]

const shouldSkipLine = (line: string) => {
  if (!line) {
    return true
  }

  return (
    line.startsWith('Štátne skúšky') ||
    line.startsWith('Obsahová náplň') ||
    line.startsWith('Podrobný sylabus') ||
    line.startsWith('Programovanie.') ||
    line.startsWith('Základy diskrétnej') ||
    line.startsWith('(predmety')
  )
}

const parseTheme = (raw: string, number: number, courseSlug: string, order: number) => {
  const compactRaw = cleanLine(raw)
  const match = compactRaw.match(/^(.*?)(?:\[(.*)\]|\((.*)\))\s*$/)

  const title = cleanLine((match?.[1] ?? compactRaw).replace(/[-–]\s*$/, ''))
  const subthemeText = match?.[2] ?? match?.[3] ?? ''

  const subthemes = subthemeText
    .split(',')
    .map((value) => cleanLine(value))
    .filter(Boolean)

  const baseSlug = slugify(title).slice(0, 80)

  return {
    slug: `${courseSlug}-${number}-${baseSlug}`,
    normalizedTitle: normalizeText(title),
    number,
    title,
    subthemes,
    sourceText: compactRaw,
    order,
  }
}

export const parseCurriculumText = (text: string): ParsedCurriculum => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter((line) => !shouldSkipLine(line))

  const courses = [] as ParsedCurriculum['courses']

  let currentCourse: ParsedCurriculum['courses'][number] | null = null
  let pendingTheme: { number: number; text: string } | null = null
  let globalOrder = 1

  const flushTheme = () => {
    if (!currentCourse || !pendingTheme) {
      return
    }

    currentCourse.themes.push(
      parseTheme(pendingTheme.text, pendingTheme.number, currentCourse.slug, globalOrder),
    )

    globalOrder += 1
    pendingTheme = null
  }

  for (const line of lines) {
    const heading = knownCourseTitles.find((title) => line === title)
    if (heading) {
      flushTheme()

      currentCourse = {
        slug: slugify(heading),
        title: heading,
        order: courses.length + 1,
        themes: [],
      }
      courses.push(currentCourse)
      continue
    }

    const themeStart = line.match(/^(\d+)\.\s*(.+)$/)
    if (themeStart) {
      flushTheme()
      pendingTheme = {
        number: Number(themeStart[1]),
        text: themeStart[2],
      }
      continue
    }

    if (pendingTheme) {
      pendingTheme.text = `${pendingTheme.text} ${line}`
    }
  }

  flushTheme()

  return {
    courses,
  }
}

export const extractCurriculumFromPdf = (pdfPath: string) => {
  const gs = spawnSync(
    'gs',
    ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=txtwrite', '-sOutputFile=-', pdfPath],
    {
      encoding: 'utf8',
    },
  )

  if (gs.status !== 0 || !gs.stdout) {
    throw new Error(`PDF parsing failed. ${gs.stderr || ''}`)
  }

  return parseCurriculumText(gs.stdout)
}

export const readTextFixture = (path: string) => readFileSync(path, 'utf8')
