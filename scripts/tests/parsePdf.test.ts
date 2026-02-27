import { describe, expect, test } from 'vitest'

import { parseCurriculumText } from '../import/parsePdf'

describe('parseCurriculumText', () => {
  test('parses course headers and wrapped themes with subthemes', () => {
    const sample = `
      Podrobný sylabus:
      Diskrétna matematika
      1. Základy matematickej logiky [logické operácie, formuly,
      výrokové funkcie]
      2. Matematický dôkaz [logický dôsledok, typy dôkazov]
      Matematická analýza
      1. Funkcia [pojem funkcie, inverzná funkcia]
    `

    const result = parseCurriculumText(sample)

    expect(result.courses).toHaveLength(2)
    expect(result.courses[0].title).toBe('Diskrétna matematika')
    expect(result.courses[0].themes).toHaveLength(2)
    expect(result.courses[0].themes[0].subthemes).toEqual([
      'logické operácie',
      'formuly',
      'výrokové funkcie',
    ])
    expect(result.courses[1].themes[0].title).toBe('Funkcia')
  })
})
