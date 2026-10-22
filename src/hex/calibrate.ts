import { axialToPixel } from './math'
import type { MapImageAlign } from './mapImage'

/**
 * Pointy-top hex radius used by HexCanvas (must stay in sync).
 * Exported so 2-point calibration solves in the same pixel space as the grid.
 */
export const HEX_SIZE = 22

/** Hex field width in canvas px (centers ± HEX_SIZE) — matches HexCanvas.hexFieldBounds (pointy odd-r). */
export function hexFieldPixelWidth(mapWidth: number, mapHeight = 2): number {
  const oddBump = mapHeight > 1 ? 0.5 : 0
  const span = HEX_SIZE * Math.sqrt(3) * (Math.max(1, mapWidth) - 1 + oddBump)
  return span + HEX_SIZE * 2
}

export interface CalibPoint {
  x: number
  y: number
}

export interface CalibHex {
  q: number
  r: number
}

/**
 * Effective underlay draw scales in canvas pixels per natural image pixel.
 * When fitWidth is on, both axes start from field-width fit, then × scaleX/Y.
 */
export function effectiveUnderlayScales(
  align: MapImageAlign,
  fieldWidth: number,
  imageNaturalWidth: number,
): { sx: number; sy: number } {
  const fitScale =
    align.fitWidth && imageNaturalWidth > 0 ? fieldWidth / imageNaturalWidth : 1
  return {
    sx: fitScale * align.scaleX,
    sy: fitScale * align.scaleY,
  }
}

/**
 * Invert a canvas-local click (coords relative to hex origin, same as axialToPixel)
 * into underlay natural-image pixels under the current align.
 */
export function canvasLocalToImagePx(
  local: CalibPoint,
  align: MapImageAlign,
  sx: number,
  sy: number,
): CalibPoint | null {
  if (!(sx > 0) || !(sy > 0)) return null
  // Underlay: local = (−HEX_SIZE + offset) + [sx, shearX; shearY, sy] * image
  const shearX = align.shearX ?? 0
  const shearY = align.shearY ?? 0
  const lx = local.x + HEX_SIZE - align.offsetX
  const ly = local.y + HEX_SIZE - align.offsetY
  const det = sx * sy - shearX * shearY
  if (!(Math.abs(det) > 1e-12)) return null
  return {
    x: (sy * lx - shearX * ly) / det,
    y: (-shearY * lx + sx * ly) / det,
  }
}

/**
 * Solve offset + independent scaleX/Y (no rotation) so two hex centers land on
 * the image features currently under two map clicks.
 *
 * Returns absolute scales with fitWidth=false (bake any prior fit into scaleX/Y).
 */
export function solveTwoPointAlign(args: {
  mapClick1: CalibPoint
  mapClick2: CalibPoint
  hex1: CalibHex
  hex2: CalibHex
  currentAlign: MapImageAlign
  fieldWidth: number
  imageNaturalWidth: number
}): MapImageAlign | { error: string } {
  const { mapClick1, mapClick2, hex1, hex2, currentAlign, fieldWidth, imageNaturalWidth } =
    args

  const { sx: curSx, sy: curSy } = effectiveUnderlayScales(
    currentAlign,
    fieldWidth,
    imageNaturalWidth,
  )
  const img1 = canvasLocalToImagePx(mapClick1, currentAlign, curSx, curSy)
  const img2 = canvasLocalToImagePx(mapClick2, currentAlign, curSx, curSy)
  if (!img1 || !img2) {
    return { error: 'Нулевой масштаб — сначала задайте Scale X/Y' }
  }

  const dxImg = img2.x - img1.x
  const dyImg = img2.y - img1.y
  if (Math.abs(dxImg) < 1e-6) {
    return { error: 'Точки почти на одной вертикали — выберите гексы дальше по X' }
  }
  if (Math.abs(dyImg) < 1e-6) {
    return { error: 'Точки почти на одной горизонтали — выберите гексы дальше по Y' }
  }

  const h1 = axialToPixel(hex1.q, hex1.r, HEX_SIZE)
  const h2 = axialToPixel(hex2.q, hex2.r, HEX_SIZE)
  const dxHex = h2.x - h1.x
  const dyHex = h2.y - h1.y

  const scaleX = dxHex / dxImg
  const scaleY = dyHex / dyImg
  if (!(scaleX > 0) || !(scaleY > 0) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    return { error: 'Не удалось решить масштаб (проверьте порядок точек / q,r)' }
  }

  // Hx = −HEX_SIZE + offsetX + ix * scaleX  →  offsetX = Hx + HEX_SIZE − ix * scaleX
  const offsetX = h1.x + HEX_SIZE - img1.x * scaleX
  const offsetY = h1.y + HEX_SIZE - img1.y * scaleY

  if (![offsetX, offsetY].every(Number.isFinite)) {
    return { error: 'Не удалось решить смещение' }
  }

  return {
    scaleX,
    scaleY,
    offsetX,
    offsetY,
    // Manual absolute scales — fit would re-bias width and undo the solve.
    fitWidth: false,
  }
}

/** Bake fitWidth into absolute scaleX/Y so the underlay does not jump. */
export function bakeFitWidthOff(
  align: MapImageAlign,
  fieldWidth: number,
  imageNaturalWidth: number,
): MapImageAlign {
  if (!align.fitWidth) return align
  const { sx, sy } = effectiveUnderlayScales(align, fieldWidth, imageNaturalWidth)
  return {
    ...align,
    scaleX: sx,
    scaleY: sy,
    fitWidth: false,
  }
}
