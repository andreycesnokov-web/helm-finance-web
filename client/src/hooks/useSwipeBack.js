import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'

// Pages where swipe-back does nothing (root pages in bottom nav)
const ROOT_PATHS = ['/', '/add', '/radar', '/accounts', '/cfo', '/settings']

export function useSwipeBack() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const startX    = useRef(null)
  const startY    = useRef(null)
  const [progress, setProgress] = useState(0)   // 0–1, drives the arc
  const [arcY,     setArcY]     = useState(0)   // Y position of arc center

  const isRoot = ROOT_PATHS.includes(location.pathname)

  useEffect(() => {
    const EDGE_ZONE  = 32   // px from left edge to start gesture
    const THRESHOLD  = 72   // px to trigger navigation
    const MAX_PULL   = 110  // px for 100% progress

    const onTouchStart = (e) => {
      if (isRoot) return
      const t = e.touches[0]
      if (t.clientX > EDGE_ZONE) return
      startX.current = t.clientX
      startY.current = t.clientY
      setArcY(t.clientY)
    }

    const onTouchMove = (e) => {
      if (startX.current === null) return
      const t = e.touches[0]
      const dx = t.clientX - startX.current
      const dy = Math.abs(t.clientY - startY.current)
      if (dx < 0 || dy > dx * 0.8) { startX.current = null; setProgress(0); return }
      setProgress(Math.min(1, dx / MAX_PULL))
      setArcY(t.clientY)
    }

    const onTouchEnd = (e) => {
      if (startX.current === null) return
      const t = e.changedTouches[0]
      const dx = t.clientX - startX.current
      const dy = Math.abs(t.clientY - startY.current)
      startX.current = null
      setProgress(0)
      if (dx > THRESHOLD && dy < dx * 0.8) {
        navigate(-1)
      }
    }

    const onTouchCancel = () => { startX.current = null; setProgress(0) }

    document.addEventListener('touchstart',  onTouchStart,  { passive: true })
    document.addEventListener('touchmove',   onTouchMove,   { passive: true })
    document.addEventListener('touchend',    onTouchEnd,    { passive: true })
    document.addEventListener('touchcancel', onTouchCancel, { passive: true })

    return () => {
      document.removeEventListener('touchstart',  onTouchStart)
      document.removeEventListener('touchmove',   onTouchMove)
      document.removeEventListener('touchend',    onTouchEnd)
      document.removeEventListener('touchcancel', onTouchCancel)
    }
  }, [isRoot, navigate])

  return { progress, arcY, isRoot }
}
