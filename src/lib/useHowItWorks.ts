import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const PATH = '/how-it-works'
const TITLE = 'How it works · Cameo'

/** The "How it works" page, opened client-side so the photos in memory survive (a reload would lose them). */
export function useHowItWorks() {
  const [isOpen, setIsOpen] = useState(() => location.pathname === PATH)
  const scrollY = useRef(0)
  const focused = useRef<Element | null>(null)
  const wasOpen = useRef(isOpen)

  const open = useCallback(() => {
    scrollY.current = window.scrollY
    focused.current = document.activeElement
    history.pushState({ how: true }, '', PATH)
    setIsOpen(true)
    window.scrollTo(0, 0)
  }, [])

  const close = useCallback(() => {
    if (history.state?.how) {
      history.back() // the popstate listener closes it
    } else {
      // A direct visit has nothing to go back to.
      history.replaceState(null, '', '/')
      setIsOpen(false)
    }
  }, [])

  useEffect(() => {
    const onPop = () => setIsOpen(location.pathname === PATH)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useLayoutEffect(() => {
    if (isOpen === wasOpen.current) return
    wasOpen.current = isOpen
    if (isOpen) return
    window.scrollTo(0, scrollY.current)
    const el = focused.current
    if (el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true })
    focused.current = null
  }, [isOpen])

  // The title and the heading focus, for a click and for a direct link alike.
  useEffect(() => {
    if (!isOpen) return
    const before = document.title
    document.title = TITLE
    // The page is lazy-loaded, so its heading may not exist yet: focus it when it appears.
    const el = document.getElementById('how-title')
    if (el) el.focus({ preventScroll: true })
    const mo = new MutationObserver(() => {
      const h = document.getElementById('how-title')
      if (!h) return
      h.focus({ preventScroll: true })
      mo.disconnect()
    })
    if (!el) mo.observe(document.body, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      document.title = before
    }
  }, [isOpen])

  return { isOpen, open, close }
}
