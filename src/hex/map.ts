import {
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  type MapAlignPersist,
  type MapData,
  type Terrain,
  type ViewportFitMode,
} from './types'

const LAYER_MODES = new Set(['both', 'map', 'grid'])
const VIEWPORT_FITS = new Set<ViewportFitMode>(['contain', 'width', 'free'])

/** Parse optional `mapAlign` / `underlay` block from a map JSON object. */
export function parseMapAlign(raw: unknown): MapAlignPersist | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const offsetX = Number(obj.offsetX)
  const offsetY = Number(obj.offsetY)
  // Prefer scaleX/scaleY; fall back to legacy uniform `scale`.
  const legacyScale = obj.scale !== undefined ? Number(obj.scale) : NaN
  const scaleX = obj.scaleX !== undefined ? Number(obj.scaleX) : legacyScale
  const scaleY = obj.scaleY !== undefined ? Number(obj.scaleY) : legacyScale
  if (![scaleX, scaleY, offsetX, offsetY].every(Number.isFinite)) return undefined

  const fitWidth = obj.fitWidth === undefined ? true : Boolean(obj.fitWidth)
  const result: MapAlignPersist = { scaleX, scaleY, offsetX, offsetY, fitWidth }

  if (obj.shearX !== undefined) {
    const shearX = Number(obj.shearX)
    if (Number.isFinite(shearX)) result.shearX = shearX
  }
  if (obj.shearY !== undefined) {
    const shearY = Number(obj.shearY)
    if (Number.isFinite(shearY)) result.shearY = shearY
  }
  if (Array.isArray(obj.perspective) && obj.perspective.length === 9) {
    const perspective = obj.perspective.map(Number)
    if (perspective.every(Number.isFinite)) result.perspective = perspective
  }
  if (Array.isArray(obj.perspectiveInv) && obj.perspectiveInv.length === 9) {
    const perspectiveInv = obj.perspectiveInv.map(Number)
    if (perspectiveInv.every(Number.isFinite)) result.perspectiveInv = perspectiveInv
  }
  if (obj.warpMesh && typeof obj.warpMesh === 'object') {
    const wm = obj.warpMesh as Record<string, unknown>
    const cols = Number(wm.cols)
    const rows = Number(wm.rows)
    if (
      Number.isFinite(cols) &&
      Number.isFinite(rows) &&
      cols >= 2 &&
      rows >= 2 &&
      Array.isArray(wm.src) &&
      Array.isArray(wm.dst) &&
      wm.src.length >= cols * rows * 2 &&
      wm.dst.length >= cols * rows * 2
    ) {
      result.warpMesh = {
        cols,
        rows,
        src: (wm.src as unknown[]).map(Number),
        dst: (wm.dst as unknown[]).map(Number),
      }
    }
  }

  if (obj.viewZoom !== undefined) {
    const viewZoom = Number(obj.viewZoom)
    if (Number.isFinite(viewZoom)) result.viewZoom = viewZoom
  }
  if (typeof obj.viewportFit === 'string' && VIEWPORT_FITS.has(obj.viewportFit as ViewportFitMode)) {
    result.viewportFit = obj.viewportFit as ViewportFitMode
  }
  if (typeof obj.layerMode === 'string' && LAYER_MODES.has(obj.layerMode)) {
    result.layerMode = obj.layerMode as MapAlignPersist['layerMode']
  }
  if (obj.gridOpacity !== undefined) {
    const gridOpacity = Number(obj.gridOpacity)
    if (Number.isFinite(gridOpacity)) {
      result.gridOpacity = Math.min(1, Math.max(0, gridOpacity))
    }
  }
  return result
}

export function createEmptyMap(
  width = DEFAULT_MAP_WIDTH,
  height = DEFAULT_MAP_HEIGHT,
): MapData {
  const w = clampSize(width)
  const h = clampSize(height)
  return {
    version: 1,
    width: w,
    height: h,
    tiles: Array.from({ length: w * h }, () => 'plain' as Terrain),
  }
}

export function clampSize(n: number): number {
  return Math.min(MAX_MAP_SIZE, Math.max(MIN_MAP_SIZE, Math.round(n)))
}

/**
 * Suggest odd-q W×H so the hex field aspect matches the underlay sheet
 * (fit-width calibration can then cover the whole leaf).
 *
 * Flat-top span (size units): horiz ≈ 1.5*(cols−1)+2, vert ≈ √3*((rows−1)+0.5)+2.
 */
export function suggestGridSizeForUnderlay(
  imageWidth: number,
  imageHeight: number,
  preferredCols = DEFAULT_MAP_WIDTH,
): { width: number; height: number } {
  if (!(imageWidth > 0) || !(imageHeight > 0)) {
    return { width: DEFAULT_MAP_WIDTH, height: DEFAULT_MAP_HEIGHT }
  }
  const cols = clampSize(preferredCols)
  const targetAspect = imageWidth / imageHeight
  const horizSpan = 1.5 * (cols - 1) + 2
  const vertSpan = horizSpan / targetAspect
  const oddBump = cols > 1 ? 0.5 : 0
  const rows = Math.round((vertSpan - 2) / Math.sqrt(3) - oddBump + 1)
  return { width: cols, height: clampSize(rows) }
}

export function tileIndex(map: MapData, q: number, r: number): number {
  return r * map.width + q
}

export function inBounds(map: MapData, q: number, r: number): boolean {
  return q >= 0 && r >= 0 && q < map.width && r < map.height
}

export function getTerrain(map: MapData, q: number, r: number): Terrain | null {
  if (!inBounds(map, q, r)) return null
  return map.tiles[tileIndex(map, q, r)] ?? null
}

export function setTerrain(map: MapData, q: number, r: number, terrain: Terrain): MapData {
  if (!inBounds(map, q, r)) return map
  const i = tileIndex(map, q, r)
  if (map.tiles[i] === terrain) return map
  const tiles = map.tiles.slice()
  tiles[i] = terrain
  return { ...map, tiles }
}

export function resizeMap(map: MapData, width: number, height: number): MapData {
  const w = clampSize(width)
  const h = clampSize(height)
  if (w === map.width && h === map.height) return map

  const tiles: Terrain[] = Array.from({ length: w * h }, () => 'plain')
  const copyW = Math.min(w, map.width)
  const copyH = Math.min(h, map.height)
  for (let r = 0; r < copyH; r++) {
    for (let q = 0; q < copyW; q++) {
      tiles[r * w + q] = map.tiles[r * map.width + q]!
    }
  }
  return {
    version: 1,
    width: w,
    height: h,
    tiles,
    ...(map.mapAlign ? { mapAlign: map.mapAlign } : {}),
  }
}

export function serializeMap(map: MapData): string {
  const payload: MapData = {
    version: 1,
    width: map.width,
    height: map.height,
    tiles: map.tiles,
  }
  if (map.mapAlign) payload.mapAlign = map.mapAlign
  return JSON.stringify(payload, null, 2)
}

export function parseMap(json: string): MapData {
  const raw: unknown = JSON.parse(json)
  if (!raw || typeof raw !== 'object') {
    throw new Error('Карта должна быть JSON-объектом')
  }
  const obj = raw as Record<string, unknown>
  if (obj.version !== 1) {
    throw new Error('Неподдерживаемая версия карты')
  }
  const width = Number(obj.width)
  const height = Number(obj.height)
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error('Некорректный размер карты')
  }
  const w = clampSize(width)
  const h = clampSize(height)
  if (!Array.isArray(obj.tiles) || obj.tiles.length !== w * h) {
    throw new Error(`Ожидалось ${w * h} тайлов`)
  }
  const allowed = new Set(['plain', 'forest', 'water'])
  const tiles: Terrain[] = []
  for (const t of obj.tiles) {
    if (typeof t !== 'string' || !allowed.has(t)) {
      throw new Error(`Неизвестный тайл: ${String(t)}`)
    }
    tiles.push(t as Terrain)
  }
  const mapAlign =
    parseMapAlign(obj.mapAlign) ?? parseMapAlign(obj.underlay) ?? undefined
  return {
    version: 1,
    width: w,
    height: h,
    tiles,
    ...(mapAlign ? { mapAlign } : {}),
  }
}
