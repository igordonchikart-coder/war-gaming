import type { MapImageAlign } from './mapImage'

/**
 * Offline auto-calibration for `public/map.webp` (~11731×9933) vs flat-top odd-q
 * overlay (`HEX_SIZE` = 22). Derived from image autocorrelation (column/row pitch)
 * + multi-point least-squares on hex centers (TL→BR).
 *
 * Residual vs printed Y-markers: ~0.15 hex median, up to ~0.25 hex at far corners
 * (scan aspect is slightly non-linear). Use «Калибровка 2 точки» for a corner touch-up.
 */
export const AUTO_CALIBRATION: MapImageAlign = {
  scaleX: 0.20213947,
  scaleY: 0.20455945,
  offsetX: -63.93,
  offsetY: -67.1012,
  fitWidth: false,
}

/** Suggested odd-q grid covering printed labels ≈ columns 10–78, rows 01–51. */
export const AUTO_CALIB_GRID_WIDTH = 69
export const AUTO_CALIB_GRID_HEIGHT = 51

/** Human-readable uncertainty for status / docs. */
export const AUTO_CALIB_ERROR_NOTE =
  'погрешность ≈0.15 гекса (медиана), до ≈0.25 на дальних углах — при необходимости дожмите «Калибровка 2 точки»'

/** Optional runtime override URL (same numbers shipped in-repo). */
export const CALIBRATION_JSON_URL = '/map/calibration.json'

export interface CalibrationFile {
  version: 1
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
  return {
    scaleX: align.scaleX,
    scaleY: align.scaleY,
    offsetX: align.offsetX,
    offsetY: align.offsetY,
    fitWidth: align.fitWidth === undefined ? false : Boolean(align.fitWidth),
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
