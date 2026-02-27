import { describe, expect, test } from 'vitest'

import { normalizeText, scoreNameMatch, slugify } from '../import/utils'

describe('import utils', () => {
  test('normalizes slovak diacritics', () => {
    expect(normalizeText('Pravdepodobnosť a štatistika')).toBe('pravdepodobnost a statistika')
  })

  test('creates stable slug', () => {
    expect(slugify('Lineárne programovanie a metódy voľnej optimalizácie')).toBe(
      'linearne-programovanie-a-metody-volnej-optimalizacie',
    )
  })

  test('name match score prefers shared tokens', () => {
    const strong = scoreNameMatch(
      'obycajne diferencialne rovnice',
      'diferencialne rovnice obycajne',
    )
    const weak = scoreNameMatch('sql dotazy', 'neuronove siete')

    expect(strong).toBeGreaterThan(weak)
  })
})
