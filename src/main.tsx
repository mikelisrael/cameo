import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

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
