/**
 * Built-in underlay presets (served from `public/`).
 * Large masters (Map2.png, map.webp) are gitignored — keep them local.
 */
export interface UnderlayPreset {
  id: string
  label: string
  url: string
}

export const UNDERLAY_PRESETS: UnderlayPreset[] = [
  { id: 'map2', label: 'Map2 (PNG)', url: '/map/Map2.png' },
  { id: 'hanko', label: 'Hanko (map.webp)', url: '/map.webp' },
  { id: 'base', label: 'Fallback base.webp', url: '/map/base.webp' },
]

/** Active default: Igor’s Map2.png (pointy-top sheet). */
export const DEFAULT_MAP_IMAGE_URL = UNDERLAY_PRESETS[0]!.url

/** Repo export used when the full master is missing or fails to load. */
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
 * Default underlay align = shipped auto-calibration for Map2.png
 * (see `src/hex/autoCalibrate.ts` / `public/map/calibration.json`).
 * Fit-width start is off: absolute canvas-px / image-px scales.
 */
export const DEFAULT_MAP_ALIGN: MapImageAlign = {
  scaleX: 0.12029217424512527,
  scaleY: 0.1211745056951297,
  offsetX: -105.37676483160448,
  offsetY: -67.4554213613577,
  shearX: 0,
  shearY: 0,
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
 * Prefer ImageBitmap for repeated canvas draws (warp triangles / underlay cache).
 * Falls back to the original source when createImageBitmap is unavailable.
 * Never resizes — full natural pixels unless the caller already downscaled.
 */
export async function toDrawableBitmap(
  source: CanvasImageSource,
): Promise<CanvasImageSource> {
  if (typeof createImageBitmap !== 'function') return source
  try {
    return await createImageBitmap(source as ImageBitmapSource)
  } catch {
    return source
  }
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
    const source = await toDrawableBitmap(limited.source)
    return {
      source,
      naturalWidth: limited.width,
      naturalHeight: limited.height,
      downscaled: limited.downscaled,
      url,
    }
  }
  const source = await toDrawableBitmap(img)
  return {
    source,
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
 * Primary defaults to Map2.png; falls back to Hanko / repo WebP exports.
 */
export async function loadMapImagesProgressive(
  primaryUrl = DEFAULT_MAP_IMAGE_URL,
  tileUrls: string[] = MAP_TILE_URLS,
  onProgress?: (loaded: LoadedMapImage, index: number, total: number) => void,
  options: MapImageLoadOptions = {},
): Promise<LoadedMapImage[]> {
  const urls = [primaryUrl, ...tileUrls]
  const results: LoadedMapImage[] = []
  const fallbacks = [
    '/map.webp',
    ...PRIMARY_FALLBACK_CHAIN,
  ] as const

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    try {
      const loaded = await loadMapImage(url, options)
      results.push(loaded)
      onProgress?.(loaded, i, urls.length)
    } catch (err) {
      if (i === 0) {
        let recovered: LoadedMapImage | null = null
        for (const fallbackUrl of fallbacks) {
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
