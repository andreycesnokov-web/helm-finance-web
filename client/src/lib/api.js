const BASE = '/api'

export async function apiFetch(path, token, options = {}) {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export function fmt(n) {
  if (n === null || n === undefined) return '—'
  const num = Number(n)
  if (Math.abs(num) >= 1e9) return (num / 1e9).toFixed(1) + 'B'
  if (Math.abs(num) >= 1e6) return (num / 1e6).toFixed(1) + 'M'
  if (Math.abs(num) >= 1e3) return (num / 1e3).toFixed(0) + 'K'
  return num.toLocaleString('ru-RU')
}

export function fmtFull(n) {
  return Number(n).toLocaleString('ru-RU')
}

export function daysUntil(dateStr) {
  return Math.round((new Date(dateStr) - new Date()) / 86400000)
}
