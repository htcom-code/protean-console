export function num(n: number): string {
  return n.toLocaleString('en-US')
}

export function pct(rate: number, digits = 2): string {
  return `${(rate * 100).toFixed(digits)}%`
}

export function clock(epochMillis: number): string {
  const d = new Date(epochMillis)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function ago(epochMillis: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - epochMillis) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  return `${Math.round(m / 60)}h ago`
}
