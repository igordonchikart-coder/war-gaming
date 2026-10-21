import {
  DEFAULT_MAP_SIZE,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  type MapAlignPersist,
  type MapData,
  type Terrain,
} from './types'

const LAYER_MODES = new Set(['both', 'map', 'grid'])

/** Parse optional `mapAlign` / `underlay` block from a map JSON object. */
export function parseMapAlign(raw: unknown): MapAlignPersist | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const scale = Number(obj.scale)
  const offsetX = Number(obj.offsetX)
  const offsetY = Number(obj.offsetY)
  if (![scale, offsetX, offsetY].every(Number.isFinite)) return undefined

  const fitWidth = obj.fitWidth === undefined ? true : Boolean(obj.fitWidth)
  const result: MapAlignPersist = { scale, offsetX, offsetY, fitWidth }

  if (obj.viewZoom !== undefined) {
    const viewZoom = Number(obj.viewZoom)
    if (Number.isFinite(viewZoom)) result.viewZoom = viewZoom
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

export function createEmptyMap(width = DEFAULT_MAP_SIZE, height = DEFAULT_MAP_SIZE): MapData {
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
