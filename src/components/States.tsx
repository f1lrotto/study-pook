export function LoadingState() {
  return <div className="panel">Načítavam dáta…</div>
}

export function ErrorState({ message }: { message: string }) {
  return <div className="panel error">{message}</div>
}

export function EmptyState({ message }: { message: string }) {
  return <div className="panel muted">{message}</div>
}
