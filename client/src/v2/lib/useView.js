import { useSearchParams } from 'react-router-dom'

/** ?view=manage ⇄ overview, kept in the URL so it is linkable and survives reload. */
export function useView() {
  const [sp, setSp] = useSearchParams()
  const view = sp.get('view') === 'manage' ? 'manage' : 'overview'
  const setView = (v) => {
    const next = new URLSearchParams(sp)
    if (v === 'manage') next.set('view', 'manage'); else next.delete('view')
    setSp(next, { replace: true })
  }
  return [view, setView]
}
