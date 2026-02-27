export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const slugify = (value: string) =>
  normalizeText(value).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')

export const cleanLine = (value: string) => value.replace(/\s+/g, ' ').trim()

export const scoreNameMatch = (a: string, b: string) => {
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
