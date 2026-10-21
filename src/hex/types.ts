export type Terrain = 'plain' | 'forest' | 'water'

export interface Axial {
  q: number
  r: number
}

export interface MapData {
  version: 1
  width: number
  height: number
  /** Flat list of terrain for every cell, index = r * width + q */
  tiles: Terrain[]
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
 * Default hexes across/down for flat-top odd-q rectangular maps.
 * ~40 columns ≈ Hanko printed density under fit-width; user can nudge size/align in UI.
 */
export const DEFAULT_MAP_SIZE = 40
export const MIN_MAP_SIZE = 4
export const MAX_MAP_SIZE = 64
export const STORAGE_KEY = 'war-gaming-map-v1'
