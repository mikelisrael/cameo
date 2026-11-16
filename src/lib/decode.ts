const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'image/avif']
const EXT = /\.(heic|heif|avif)$/i
const HEIC_EXT = /\.(heic|heif)$/i

/** Photos the app opens. Windows often gives HEIC files no type, so an empty type is judged by extension. */
export function isAcceptedImage(file: File) {
  if (MIME.includes(file.type)) return true
  return (file.type === '' || file.type === 'application/octet-stream') && EXT.test(file.name)
}

/** What the file picker's `accept` attribute lists: the types and the extensions. */
export const ACCEPT_ATTR = [...MIME, '.heic', '.heif', '.avif'].join(',')

const isHeicFile = (file: File) => file.type === 'image/heic' || file.type === 'image/heif' || HEIC_EXT.test(file.name)

const isApple =
  typeof navigator !== 'undefined' &&
  (/iPhone|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

/** iOS Safari's canvas area limit is 4096 x 4096; elsewhere a generous cap keeps three full-size canvases affordable. */
const MAX_PIXELS = isApple ? 16_777_216 : 24_000_000

export type Decoded = {
  bitmap: ImageBitmap // what is shown, cut out and exported (already capped)
  /** Set when the picture was shrunk to fit this device's working size. */
  scaled?: { from: { width: number; height: number }; to: { width: number; height: number } }
  /** A URL an <img> can show: the file's own for PNG/JPG/WebP/AVIF, a JPEG made from the pixels for HEIC. Caller revokes it. */
  url: string
}

const FAILED = "Couldn't open this photo"

async function toBitmap(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    if (!isHeicFile(file)) throw new Error(FAILED)
  }
  try {
    // Loaded only when a HEIC arrives; the decoder runs off the main thread.
    const { heicTo } = await import('heic-to')
    return await heicTo({ blob: file, type: 'bitmap' })
  } catch {
    throw new Error(FAILED)
  }
}

function jpegUrl(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error(FAILED))),
      'image/jpeg',
      0.92,
    ),
  )
}

export async function decodeImage(file: File): Promise<Decoded> {
  let bitmap = await toBitmap(file)
  let scaled: Decoded['scaled']
  const { width, height } = bitmap
  if (width * height > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (width * height))
    const to = { width: Math.floor(width * k), height: Math.floor(height * k) }
    try {
      const small = await createImageBitmap(bitmap, {
        resizeWidth: to.width,
        resizeHeight: to.height,
        resizeQuality: 'high',
      })
      bitmap.close()
      bitmap = small
      scaled = { from: { width, height }, to }
    } catch {
      bitmap.close()
      throw new Error(FAILED)
    }
  }
  try {
    const url = scaled || isHeicFile(file) ? await jpegUrl(bitmap) : URL.createObjectURL(file)
    return { bitmap, scaled, url }
  } catch (e) {
    bitmap.close()
    throw e
  }
}
