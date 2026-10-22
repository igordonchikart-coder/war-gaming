import type { MapImageAlign } from './mapImage'
import { isWarpMesh } from './warp'
import autoCalibData from './autoCalibData.json'

/**
 * Offline auto-calibration for `public/map/Map2.png` (~22917×13302) vs
 * pointy-top odd-r overlay (`HEX_SIZE` = 22). Eight anchors (4 corners +
 * side mids + center) → TPS mesh warping the underlay onto the ideal hex
 * grid. Affine scale/shear remain as a coarse fallback when the mesh is stripped.
 */
const baked = autoCalibData.mapAlign as MapImageAlign

export const AUTO_CALIBRATION: MapImageAlign = {
  scaleX: baked.scaleX,
  scaleY: baked.scaleY,
  offsetX: baked.offsetX,
  offsetY: baked.offsetY,
  shearX: baked.shearX ?? 0,
  shearY: baked.shearY ?? 0,
  fitWidth: false,
  ...(Array.isArray(baked.perspective) && baked.perspective.length === 9
    ? { perspective: baked.perspective as number[] }
    : {}),
  ...(Array.isArray(baked.perspectiveInv) && baked.perspectiveInv.length === 9
    ? { perspectiveInv: baked.perspectiveInv as number[] }
    : {}),
  ...(isWarpMesh(baked.warpMesh) ? { warpMesh: baked.warpMesh } : {}),
}

/** Suggested odd-r grid covering Map2 printed hexes ≈ 66×44. */
export const AUTO_CALIB_GRID_WIDTH = 66
export const AUTO_CALIB_GRID_HEIGHT = 44

/** Human-readable uncertainty for status / docs. */
export const AUTO_CALIB_ERROR_NOTE =
  'TPS-варп по 8 якорям (углы+середины+центр); сетка идеальная pointy-top — подложка Map2 садится на неё'

/** Optional runtime override URL (same numbers shipped in-repo). */
export const CALIBRATION_JSON_URL = '/map/calibration.json'

export interface CalibrationFile {
  version: 2 | 3
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

function pickAlign(a: MapImageAlign): MapImageAlign {
  const out: MapImageAlign = {
    scaleX: a.scaleX,
    scaleY: a.scaleY,
    offsetX: a.offsetX,
    offsetY: a.offsetY,
    shearX: typeof a.shearX === 'number' && Number.isFinite(a.shearX) ? a.shearX : 0,
    shearY: typeof a.shearY === 'number' && Number.isFinite(a.shearY) ? a.shearY : 0,
    fitWidth: a.fitWidth === undefined ? false : Boolean(a.fitWidth),
  }
  if (Array.isArray(a.perspective) && a.perspective.length === 9) {
    out.perspective = a.perspective.map(Number)
  }
  if (Array.isArray(a.perspectiveInv) && a.perspectiveInv.length === 9) {
    out.perspectiveInv = a.perspectiveInv.map(Number)
  }
  if (isWarpMesh(a.warpMesh)) {
    out.warpMesh = {
      cols: a.warpMesh.cols,
      rows: a.warpMesh.rows,
      src: a.warpMesh.src.map(Number),
      dst: a.warpMesh.dst.map(Number),
    }
  }
  return out
}

/** Parse `/map/calibration.json` body (or a bare mapAlign object). */
export function parseCalibrationFile(raw: unknown): MapImageAlign | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const align = obj.mapAlign ?? obj
  if (!isMapImageAlign(align)) return null
  return pickAlign(align as MapImageAlign)
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
