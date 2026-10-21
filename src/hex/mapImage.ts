/**
 * Prefer full local underlay `public/map.webp` (often gitignored if huge).
 * Falls back to the repo-friendly export in `public/map/` only if the primary fails.
 */
export const DEFAULT_MAP_IMAGE_URL = '/map.webp'

/** Repo export used when the full `map.webp` is missing or fails to load. */
export const FALLBACK_MAP_IMAGE_URL = '/map/base.webp'

/** Smaller last-resort asset if the primary fallback also fails. */
export const SECONDARY_FALLBACK_MAP_IMAGE_URL = '/map/base-2048.webp'

/**
 * Optional cap used only by “быстрая подложка” mode.
 * Full quality (default) never applies this — prefer lag over silent downscale.
 */
export const FAST_MAP_TEXTURE_EDGE = 4096

/**
 * Additional tile URLs (loaded one-by-one). Put files in `public/map/` and list
 * them here when splitting a huge source into tiles.
 */
export const MAP_TILE_URLS: string[] = []

export type MapLayerMode = 'both' | 'map' | 'grid'

export interface MapImageAlign {
  /**
   * Horizontal underlay scale vs hex field.
   * With fitWidth: multiplier on (fieldWidth / imageWidth); without: canvas-px per image-px.
   */
  scaleX: number
  /**
   * Vertical underlay scale (independent of scaleX — fixes printed-grid aspect drift).
   * Same units as scaleX.
   */
  scaleY: number
  offsetX: number
  offsetY: number
/**
   * Affine shear: canvas Δx from image y (`local_x += shearX * iy`).
   * Corrects mild scan tilt / non-orthogonal printed grid.
   */
  shearX?: number
  /**
   * Affine shear: canvas Δy from image x (`local_y += shearY * ix`).
   */
  shearY?: number
  /**
   * 3×3 row-major homography: image px → hex-local (axialToPixel space).
   * Used when `warpMesh` is absent; Canvas draws a subdivided approximation.
   */
  perspective?: number[]
  /**
   * Inverse of `perspective` (hex-local → image). Optional; for 2-point calib.
   */
  perspectiveInv?: number[]
  /**
   * Baked TPS/mesh warp: image control points → hex-local. Preferred over
   * affine/perspective when present (pins corners + mids + center).
   */
  warpMesh?: {
    cols: number
    rows: number
    src: number[]
    dst: number[]
  }
  /**
   * When true, underlay width matches hex field width (calibration vs grid).
   * Independent of viewport framing («Вся карта» / «По ширине»).
   * Manual scaleX/Y or 2-point calib turn this off (fit is a starting point only).
   */
  fitWidth: boolean
}

/**
 * Default underlay align = shipped auto-calibration for full `map.webp`
 * (see `src/hex/autoCalibrate.ts` / `public/map/calibration.json`).
 * Fit-width start is off: absolute canvas-px / image-px scales.
 */
export const DEFAULT_MAP_ALIGN: MapImageAlign = {
  scaleX: 0.2071352744006969,
  scaleY: 0.21006707868221847,
  offsetX: -66.7056773169919,
  offsetY: -63.210532755200916,
  shearX: -3.1477003166301934e-10,
  shearY: 4.847403493297244e-06,
  fitWidth: false,
}

export interface MapImageLoadOptions {
  /**
   * When true, may downscale to FAST_MAP_TEXTURE_EDGE for GPU/memory.
   * Default false = keep natural pixels (master quality).
   */
  fast?: boolean
}

export interface LoadedMapImage {
  /** Drawable source — HTMLImageElement at natural size unless `fast` downscaled. */
  source: CanvasImageSource
  /** Pixel size of `source` (natural unless fast-downscaled). */
  naturalWidth: number
  naturalHeight: number
  /** True only when optional fast mode resized the bitmap. */
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

/**
 * Optional downscale for “быстрая подложка”. Not used by default.
 * Returns the original image when already within maxEdge.
 */
export function limitTextureSize(
  img: HTMLImageElement,
  maxEdge = FAST_MAP_TEXTURE_EDGE,
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

/** Load one map URL at natural resolution unless `options.fast` is set. */
export async function loadMapImage(
  url: string,
  options: MapImageLoadOptions = {},
): Promise<LoadedMapImage> {
  const img = await loadHtmlImage(url)
  if (options.fast) {
    const limited = limitTextureSize(img)
    return {
      source: limited.source,
      naturalWidth: limited.width,
      naturalHeight: limited.height,
      downscaled: limited.downscaled,
      url,
    }
  }
  return {
    source: img,
    naturalWidth: img.naturalWidth,
    naturalHeight: img.naturalHeight,
    downscaled: false,
    url,
  }
}

const PRIMARY_FALLBACK_CHAIN = [
  FALLBACK_MAP_IMAGE_URL,
  SECONDARY_FALLBACK_MAP_IMAGE_URL,
] as const

/**
 * Load primary map, then optional tiles sequentially (never all at once).
 * Primary is always `/map.webp` (full master). Repo WebP exports are fallbacks only.
 */
export async function loadMapImagesProgressive(
  primaryUrl = DEFAULT_MAP_IMAGE_URL,
  tileUrls: string[] = MAP_TILE_URLS,
  onProgress?: (loaded: LoadedMapImage, index: number, total: number) => void,
  options: MapImageLoadOptions = {},
): Promise<LoadedMapImage[]> {
  const urls = [primaryUrl, ...tileUrls]
  const results: LoadedMapImage[] = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    try {
      const loaded = await loadMapImage(url, options)
      results.push(loaded)
      onProgress?.(loaded, i, urls.length)
    } catch (err) {
      if (i === 0) {
        let recovered: LoadedMapImage | null = null
        for (const fallbackUrl of PRIMARY_FALLBACK_CHAIN) {
          if (fallbackUrl === primaryUrl) continue
          try {
            recovered = await loadMapImage(fallbackUrl, options)
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
