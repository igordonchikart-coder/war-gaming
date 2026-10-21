/** Max edge for GPU-friendly canvas textures (avoids loading 10k+ px maps as-is). */
export const MAX_MAP_TEXTURE_EDGE = 4096

/**
 * Prefer full local underlay `public/map.webp` (often gitignored if huge).
 * Falls back to the repo-friendly export in `public/map/`.
 */
export const DEFAULT_MAP_IMAGE_URL = '/map.webp'

/** Repo export used when the full `map.webp` is missing or fails to load. */
export const FALLBACK_MAP_IMAGE_URL = '/map/base.webp'

/** Smaller last-resort asset if the primary fallback also fails. */
export const SECONDARY_FALLBACK_MAP_IMAGE_URL = '/map/base-2048.webp'

/**
 * Additional tile URLs (loaded one-by-one). Put files in `public/map/` and list
 * them here when splitting a huge source into tiles.
 */
export const MAP_TILE_URLS: string[] = []

export type MapLayerMode = 'both' | 'map' | 'grid'

export interface MapImageAlign {
  /** Relative to hex-grid pixel width: 1 = fit width of the hex field. */
  scale: number
  offsetX: number
  offsetY: number
  /** When true, scale is derived so image width matches hex field width. */
  fitWidth: boolean
}

export const DEFAULT_MAP_ALIGN: MapImageAlign = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  fitWidth: true,
}

export interface LoadedMapImage {
  /** Drawable source (may be an offscreen canvas after downscale). */
  source: CanvasImageSource
  naturalWidth: number
  naturalHeight: number
  /** True if we resized because the source exceeded MAX_MAP_TEXTURE_EDGE. */
  downscaled: boolean
  url: string
}

function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Не удалось загрузить карту: ${url}`))
    img.src = url
  })
}

/** Downscale to max edge with smoothing; returns original if already small enough. */
export function limitTextureSize(
  img: HTMLImageElement,
  maxEdge = MAX_MAP_TEXTURE_EDGE,
): { source: CanvasImageSource; width: number; height: number; downscaled: boolean } {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const edge = Math.max(w, h)
  if (edge <= maxEdge) {
    return { source: img, width: w, height: h, downscaled: false }
  }

  const scale = maxEdge / edge
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { source: img, width: w, height: h, downscaled: false }
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, tw, th)
  return { source: canvas, width: tw, height: th, downscaled: true }
}

/** Load one map URL; downscale if larger than max texture edge. */
export async function loadMapImage(url: string): Promise<LoadedMapImage> {
  const img = await loadHtmlImage(url)
  const limited = limitTextureSize(img)
  return {
    source: limited.source,
    naturalWidth: limited.width,
    naturalHeight: limited.height,
    downscaled: limited.downscaled,
    url,
  }
}

const PRIMARY_FALLBACK_CHAIN = [
  FALLBACK_MAP_IMAGE_URL,
  SECONDARY_FALLBACK_MAP_IMAGE_URL,
] as const

/**
 * Load primary map, then optional tiles sequentially (never all at once).
 * Falls back through repo WebP exports if the primary URL fails.
 */
export async function loadMapImagesProgressive(
  primaryUrl = DEFAULT_MAP_IMAGE_URL,
  tileUrls: string[] = MAP_TILE_URLS,
  onProgress?: (loaded: LoadedMapImage, index: number, total: number) => void,
): Promise<LoadedMapImage[]> {
  const urls = [primaryUrl, ...tileUrls]
  const results: LoadedMapImage[] = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    try {
      const loaded = await loadMapImage(url)
      results.push(loaded)
      onProgress?.(loaded, i, urls.length)
    } catch (err) {
      if (i === 0) {
        let recovered: LoadedMapImage | null = null
        for (const fallbackUrl of PRIMARY_FALLBACK_CHAIN) {
          if (fallbackUrl === primaryUrl) continue
          try {
            recovered = await loadMapImage(fallbackUrl)
            break
          } catch {
            // try next fallback
          }
        }
        if (recovered) {
          results.push(recovered)
          onProgress?.(recovered, i, urls.length)
          continue
        }
        throw err
      }
      // Skip missing optional tiles
      console.warn(err)
    }
  }

  return results
}
