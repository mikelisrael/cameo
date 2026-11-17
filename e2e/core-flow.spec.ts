import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { chromium, expect, test as base, type Page } from '@playwright/test'

// A persistent profile keeps the model in the browser's Cache API between runs.
const test = base.extend({
  context: async ({ baseURL }, use, testInfo) => {
    const context = await chromium.launchPersistentContext(path.resolve('.cache/e2e-profile'), {
      baseURL,
      viewport: { width: 1280, height: 800 },
      serviceWorkers: 'block',
      acceptDownloads: true,
    })
    await context.tracing.start({ screenshots: true, snapshots: true })
    await use(context)
    // Persistent contexts ignore the config's `trace`, so keep the trace on failure by hand.
    if (testInfo.status !== testInfo.expectedStatus) {
      await context.tracing.stop({ path: testInfo.outputPath('trace.zip') })
    } else {
      await context.tracing.stop()
    }
    await context.close()
  },
  page: async ({ context }, use) => {
    await use(context.pages()[0] ?? (await context.newPage()))
  },
})

const WIDTH = 640
const HEIGHT = 480

type Pixel = { r: number; g: number; b: number; a: number }
type Sample = { corners: Pixel[]; centre: Pixel; width: number; height: number }

/** Draw a grey backdrop with a persimmon disk and drop it on the drop zone as a real file drop. */
async function dropTestImage(page: Page) {
  await page.evaluate(
    async ({ width, height }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#e6e6e6'
      ctx.fillRect(0, 0, width, height)
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
      ctx.beginPath()
      ctx.arc(width / 2 + 6, height / 2 + 10, 162, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#e8562a'
      ctx.beginPath()
      ctx.arc(width / 2, height / 2, 150, 0, Math.PI * 2)
      ctx.fill()
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'),
      )
      const data = new DataTransfer()
      data.items.add(new File([blob], 'subject.png', { type: 'image/png' }))
      const zone = document.querySelector('.drop')!
      for (const type of ['dragenter', 'dragover', 'drop']) {
        zone.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
      }
    },
    { width: WIDTH, height: HEIGHT },
  )
}

/** Click Download PNG, save the file, and return its bytes. */
async function download(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download PNG' }).click()
  const file = await pending
  const target = testInfo.outputPath(name)
  await file.saveAs(target)
  return readFile(target)
}

/** Decode the PNG in the page and read the corners (inset 10px) and the centre. */
async function sample(page: Page, png: Buffer): Promise<Sample> {
  return page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const { width, height } = bitmap
    const ctx = new OffscreenCanvas(width, height).getContext('2d')!
    ctx.drawImage(bitmap, 0, 0)
    const at = (x: number, y: number) => {
      const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data
      return { r, g, b, a }
    }
    const inset = 10
    return {
      width,
      height,
      corners: [
        at(inset, inset),
        at(width - 1 - inset, inset),
        at(inset, height - 1 - inset),
        at(width - 1 - inset, height - 1 - inset),
      ],
      centre: at(Math.floor(width / 2), Math.floor(height / 2)),
    }
  }, png.toString('base64'))
}

function expectPng(png: Buffer) {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
}

test('drop, cut out on the CPU, change the background, download', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('cutout:force-wasm', '1')
    // Without Web Share the primary button is always "Download PNG".
    Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true })
  })

  await page.goto('/')
  await dropTestImage(page)
  await expect(page.locator('[data-state="done"]')).toBeVisible({ timeout: 4 * 60_000 })

  // The forced-CPU path really ran.
  await page.getByRole('button', { name: 'About this device' }).click()
  await expect(page.getByRole('dialog', { name: 'About this device' })).toContainText('Processor (WebAssembly)')
  await page.keyboard.press('Escape')

  // Transparent: corners are cleared, the subject stays.
  const clear = await download(page, testInfo, 'transparent.png')
  expectPng(clear)
  const a = await sample(page, clear)
  expect([a.width, a.height]).toEqual([WIDTH, HEIGHT])
  for (const c of a.corners) expect(c.a).toBeLessThanOrEqual(10)
  expect(a.centre.a).toBeGreaterThanOrEqual(245)
  expect(a.centre.r).toBeGreaterThan(180)

  // White: corners are opaque white, the subject is unchanged.
  await page.getByRole('radio', { name: 'White' }).check({ force: true })
  const white = await download(page, testInfo, 'white.png')
  expectPng(white)
  const b = await sample(page, white)
  expect([b.width, b.height]).toEqual([WIDTH, HEIGHT])
  for (const c of b.corners) {
    expect(c).toEqual({ r: expect.any(Number), g: expect.any(Number), b: expect.any(Number), a: 255 })
    expect(Math.min(c.r, c.g, c.b)).toBeGreaterThanOrEqual(245)
  }
  expect(b.centre.a).toBe(255)
  expect(b.centre.r).toBeGreaterThan(180)
})
