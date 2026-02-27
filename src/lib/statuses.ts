export const progressStatuses = ['not_started', 'in_progress', 'reviewed', 'mastered'] as const

export const progressStatusLabels: Record<(typeof progressStatuses)[number], string> = {
  not_started: 'Nezačaté',
  in_progress: 'Rozpracované',
  reviewed: 'Prejdené',
  mastered: 'Zvládnuté',
}

export const getProgressStatusColor = (status: (typeof progressStatuses)[number]) => {
  if (status === 'mastered') {
    return 'var(--success)'
  }

  if (status === 'reviewed') {
    return 'var(--accent)'
  }

  if (status === 'in_progress') {
    return 'var(--warning)'
  }

  return 'var(--muted)'
}
