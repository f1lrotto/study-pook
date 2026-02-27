export const formatPercent = (value: number) => `${Math.round(value * 100)} %`

export const formatConfidence = (value: number) => value.toFixed(1)

export const trimTo = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}…`
}
