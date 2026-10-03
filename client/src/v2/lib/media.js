import { useEffect, useState } from 'react'

/** true below the desktop breakpoint (matches v2.css 1023px). */
export function useIsPhone() {
  const q = '(max-width: 1023px)'
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q).matches : false)
  const [on, setOn] = useState(get)
  useEffect(() => {
    if (!window.matchMedia) return undefined
    const m = window.matchMedia(q)
    const h = () => setOn(m.matches)
    m.addEventListener ? m.addEventListener('change', h) : m.addListener(h)
    return () => { m.removeEventListener ? m.removeEventListener('change', h) : m.removeListener(h) }
  }, [])
  return on
}
