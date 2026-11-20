import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'
import { registerSW } from 'virtual:pwa-register'
import { countPageView } from './lib/count'

// Updates wait for every tab to close; skipping waiting under open tabs strands them on deleted chunks.
registerSW({ immediate: true })

// `?bench` opens the dev comparison page, kept in its own chunk.
const Bench = lazy(() => import('./bench/Bench'))
const bench = new URLSearchParams(location.search).has('bench')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {bench ? (
      <Suspense fallback={null}>
        <Bench />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)

if (!bench) countPageView()
