export type Terrain = 'plain' | 'forest' | 'water'

export interface Axial {
  q: number
  r: number
}

/** How the scene sits in the canvas viewport (not underlay↔hex calibration). */
export type ViewportFitMode = 'contain' | 'width' | 'free'

/** Persisted underlay/grid calibration (also accepted as JSON key `underlay`). */
export interface MapAlignPersist {
  /** Horizontal scale (legacy JSON `scale` is read as scaleX=scaleY when scaleX/Y absent). */
  scaleX: number
  /** Vertical scale — independent to correct printed-grid aspect / cumulative drift. */
  scaleY: number
  offsetX: number
  offsetY: number
  /** Optional affine shear (canvas Δx from image y). */
  shearX?: number
  /** Optional affine shear (canvas Δy from image x). */
  shearY?: number
  /** 3×3 row-major homography image→hex-local. */
  perspective?: number[]
  perspectiveInv?: number[]
  /** TPS/mesh warp (preferred): image control pts → hex-local. */
  warpMesh?: {
    cols: number
    rows: number
    src: number[]
    dst: number[]
  }
  fitWidth: boolean
  /** Scene zoom from pinch / ctrl+wheel. */
  viewZoom?: number
  /**
   * Viewport framing: `contain` = entire map sheet in frame (default),
   * `width` = fit sheet width, `free` = manual pan/zoom.
   */
  viewportFit?: ViewportFitMode
  layerMode?: 'both' | 'map' | 'grid'
  gridOpacity?: number
}

export interface MapData {
  version: 1
  width: number
  height: number
  /** Flat list of terrain for every cell, index = r * width + q */
  tiles: Terrain[]
  /** Calibration for underlay align + optional view zoom / layer. */
  mapAlign?: MapAlignPersist
}

export const TERRAIN_LABELS: Record<Terrain, string> = {
  plain: 'Равнина',
  forest: 'Лес',
  water: 'Вода',
}

export const TERRAIN_COLORS: Record<Terrain, string> = {
  plain: '#c5d6a1',
  forest: '#3d6b3a',
  water: '#3a6ea5',
}

/**
 * Default hex grid for pointy-top odd-r Map2.png (~22917×13302) ≈ 66×44.
 */
export const DEFAULT_MAP_WIDTH = 66
export const DEFAULT_MAP_HEIGHT = 44
/** @deprecated Prefer DEFAULT_MAP_WIDTH / DEFAULT_MAP_HEIGHT. */
export const DEFAULT_MAP_SIZE = DEFAULT_MAP_WIDTH
export const MIN_MAP_SIZE = 4
/** Hard safety clamp (memory / canvas). UI warns above WARN_MAP_SIZE. */
export const MAX_MAP_SIZE = 256
/** Soft UI warning threshold — inputs still accept up to MAX_MAP_SIZE. */
export const WARN_MAP_SIZE = 200
/** Skip per-hex q,r labels when cell count exceeds this (LOD). */
export const LABEL_CELL_LIMIT = 2500
/**
 * Bump when shipped absolute auto-calibration changes so stale localStorage
 * (e.g. old flat-top Hanko / pre-Map2) cannot override.
 */
export const STORAGE_KEY = 'war-gaming-map-v4'
/** Separate key for last calibration snapshot (mirrors mapAlign in the map JSON). */
export const ALIGN_STORAGE_KEY = 'war-gaming-map-align-v4'
/** Legacy keys — cleared on autocalibrate / first load of v4. */
export const LEGACY_STORAGE_KEYS = [
  'war-gaming-map-v1',
  'war-gaming-map-align-v1',
  'war-gaming-map-v2',
  'war-gaming-map-align-v2',
  'war-gaming-map-v3',
  'war-gaming-map-align-v3',
] as const
