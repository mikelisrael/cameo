// Phase 4 budget: the first screen's JS stays under 100 kB gzip. We gzip at level 9, which errs safe
// against Vercel's brotli.
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const BUDGET = 100_000
const html = readFileSync('dist/index.html', 'utf8')
const paths = new Set()
for (const tag of html.match(/<script\b[^>]*>/g) ?? []) {
  if (/type="module"/.test(tag)) paths.add(tag.match(/\bsrc="([^"]+)"/)?.[1])
}
for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
  if (/rel="modulepreload"/.test(tag)) paths.add(tag.match(/\bhref="([^"]+)"/)?.[1])
}
paths.delete(undefined)

let total = 0
for (const p of paths) {
  total += gzipSync(readFileSync(`dist/${p.replace(/^\.?\//, '')}`), { level: 9 }).length
}
console.log(`First screen JS: ${(total / 1000).toFixed(1)} kB gzip (budget ${BUDGET / 1000} kB)`)
if (total > BUDGET) {
  console.error(`Over budget by ${((total - BUDGET) / 1000).toFixed(1)} kB: keep code the first screen does not need behind a dynamic import.`)
  process.exit(1)
}
