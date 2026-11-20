// Cookieless counts via GoatCounter: the page path on open, and an event when a cut-out is made.
// No photo data, title, referrer or screen size is ever sent.

// The GoatCounter site code (`<code>.goatcounter.com`); empty means counting is off.
const GOATCOUNTER = ''

function send(params: Record<string, string>): void {
  try {
    if (!GOATCOUNTER || import.meta.env.DEV) return
    const host = location.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.local')) return
    if (new URLSearchParams(location.search).has('bench')) return
    if (navigator.doNotTrack === '1') return
    if ((navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return
    const url = `https://${GOATCOUNTER}.goatcounter.com/count?` + new URLSearchParams(params).toString()
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url)) return
    fetch(url, { method: 'POST', mode: 'no-cors', keepalive: true, credentials: 'omit' }).catch(() => {})
  } catch {
    // Counting must never break the page.
  }
}

export function countPageView(): void {
  send({ p: location.pathname })
}

export function countCutout(): void {
  send({ p: 'cutout', e: 'true' })
}
