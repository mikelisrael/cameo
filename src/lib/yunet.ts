import type { Face } from './protocol'

/** YuNet (2023mar) takes a fixed 640 x 640 input. */
export const YUNET_SIZE = 640

const STRIDES = [8, 16, 32]
const SCORE_THRESHOLD = 0.6
const NMS_THRESHOLD = 0.3
const TOP_K = 5000

type Output = ArrayLike<number>

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function iou(a: Face['box'], b: Face['box']) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.w * a.h + b.w * b.h - inter)
}

/**
 * Decode YuNet's twelve outputs the way OpenCV's FaceDetectorYN does. `outputs` is keyed by output name
 * (cls_8 ... kps_32). Coordinates are in input pixels; detections whose centre lies outside the
 * `width` x `height` image placed at the input's top-left corner (the padding) are dropped. Highest score first.
 */
export function decodeYunet(outputs: Record<string, Output>, width: number, height: number): Face[] {
  const found: Face[] = []
  for (const s of STRIDES) {
    const cls = outputs[`cls_${s}`]
    const obj = outputs[`obj_${s}`]
    const bbox = outputs[`bbox_${s}`]
    const kps = outputs[`kps_${s}`]
    const cols = YUNET_SIZE / s
    for (let i = 0; i < cols * cols; i++) {
      const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]))
      if (score < SCORE_THRESHOLD) continue
      const r = Math.floor(i / cols)
      const c = i % cols
      const cx = (c + bbox[i * 4]) * s
      const cy = (r + bbox[i * 4 + 1]) * s
      if (cx >= width || cy >= height) continue
      const w = Math.exp(bbox[i * 4 + 2]) * s
      const h = Math.exp(bbox[i * 4 + 3]) * s
      const pt = (k: number) => ({ x: (kps[i * 10 + 2 * k] + c) * s, y: (kps[i * 10 + 2 * k + 1] + r) * s })
      found.push({
        score,
        box: { x: cx - w / 2, y: cy - h / 2, w, h },
        eyeR: pt(0),
        eyeL: pt(1),
        nose: pt(2),
        mouthR: pt(3),
        mouthL: pt(4),
      })
    }
  }
  found.sort((a, b) => b.score - a.score)
  const kept: Face[] = []
  for (const f of found.slice(0, TOP_K)) {
    if (kept.every((k) => iou(k.box, f.box) <= NMS_THRESHOLD)) kept.push(f)
  }
  return kept
}
