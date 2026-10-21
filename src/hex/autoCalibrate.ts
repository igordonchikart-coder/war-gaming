import type { MapImageAlign } from './mapImage'

/**
 * Offline auto-calibration for `public/map.webp` (~11731×9933) vs flat-top odd-q
 * overlay (`HEX_SIZE` = 22). Horizontal Y-edge rows + column pitch (AC/FFT) +
 * light affine shear for scan tilt.
 *
 * Residual vs printed Y-markers: typically ≈0.1–0.2 hex; far corners can be worse
 * where the scan is non-linear. Use «Калибровка 2 точки» to touch up a corner.
 */
export const AUTO_CALIBRATION: MapImageAlign = {
  scaleX: 0.20245399,
  scaleY: 0.20322729,
  offsetX: -62.625767,
  offsetY: -58.884463,
  shearX: -0.00035,
  shearY: 0.00085,
  fitWidth: false,
}

/** Suggested odd-q grid covering printed labels ≈ columns 10–78, rows 01–51. */
export const AUTO_CALIB_GRID_WIDTH = 69
export const AUTO_CALIB_GRID_HEIGHT = 51

/** Human-readable uncertainty for status / docs. */
export const AUTO_CALIB_ERROR_NOTE =
  'погрешность ≈0.1–0.2 гекса (скан слегка нелинеен) — при необходимости дожмите «Калибровка 2 точки»'

/** Optional runtime override URL (same numbers shipped in-repo). */
export const CALIBRATION_JSON_URL = '/map/calibration.json'

export interface CalibrationFile {
  version: 2
  source: string
  imageWidth: number
  imageHeight: number
  hexSize: number
  gridWidth: number
  gridHeight: number
  mapAlign: MapImageAlign
  errorNote?: string
}

export function isMapImageAlign(raw: unknown): raw is MapImageAlign {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return [o.scaleX, o.scaleY, o.offsetX, o.offsetY].every(
    (n) => typeof n === 'number' && Number.isFinite(n),
  )
}

/** Parse `/map/calibration.json` body (or a bare mapAlign object). */
export function parseCalibrationFile(raw: unknown): MapImageAlign | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const align = obj.mapAlign ?? obj
  if (!isMapImageAlign(align)) return null
  const a = align as MapImageAlign
  return {
    scaleX: a.scaleX,
    scaleY: a.scaleY,
    offsetX: a.offsetX,
    offsetY: a.offsetY,
    shearX: typeof a.shearX === 'number' && Number.isFinite(a.shearX) ? a.shearX : 0,
    shearY: typeof a.shearY === 'number' && Number.isFinite(a.shearY) ? a.shearY : 0,
    fitWidth: a.fitWidth === undefined ? false : Boolean(a.fitWidth),
  }
}

/** Fetch shipped calibration; falls back to baked-in AUTO_CALIBRATION. */
export async function loadShippedCalibration(
  url = CALIBRATION_JSON_URL,
): Promise<{ align: MapImageAlign; fromFile: boolean }> {
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return { align: { ...AUTO_CALIBRATION }, fromFile: false }
    const json: unknown = await res.json()
    const parsed = parseCalibrationFile(json)
    if (!parsed) return { align: { ...AUTO_CALIBRATION }, fromFile: false }
    return { align: parsed, fromFile: true }
  } catch {
    return { align: { ...AUTO_CALIBRATION }, fromFile: false }
  }
}
