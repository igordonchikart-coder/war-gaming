/**
 * Underlay warp: map image pixels → hex-local (axialToPixel) space via
 * perspective (3×3) or a bilinear mesh (TPS baked offline).
 *
 * Canvas2D cannot do true perspective in one drawImage call, so we subdivide
 * the source into quads and approximate each with two textured triangles.
 */

export interface WarpMesh {
  cols: number
  rows: number
  /** Row-major image-space control points: [x0,y0, x1,y1, ...] length cols*rows*2 */
  src: number[]
  /** Same layout in hex-local (axialToPixel) space. */
  dst: number[]
}

function meshPoint(
  coords: number[],
  cols: number,
  i: number,
  j: number,
): { x: number; y: number } {
  const idx = (j * cols + i) * 2
  return { x: coords[idx]!, y: coords[idx + 1]! }
}

/**
 * Draw `img` warped so mesh src (image px) lands on mesh dst (hex-local),
 * then shifted by (originX, originY) in canvas space.
 * origin = hex field origin where hex-local (0,0) is drawn.
 */
export function drawWarpedImage(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  mesh: WarpMesh,
  originX: number,
  originY: number,
): void {
  const { cols, rows, src, dst } = mesh
  if (cols < 2 || rows < 2) return
  if (src.length < cols * rows * 2 || dst.length < cols * rows * 2) return

  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const s00 = meshPoint(src, cols, i, j)
      const s10 = meshPoint(src, cols, i + 1, j)
      const s01 = meshPoint(src, cols, i, j + 1)
      const s11 = meshPoint(src, cols, i + 1, j + 1)
      const d00 = meshPoint(dst, cols, i, j)
      const d10 = meshPoint(dst, cols, i + 1, j)
      const d01 = meshPoint(dst, cols, i, j + 1)
      const d11 = meshPoint(dst, cols, i + 1, j + 1)

      // Two triangles: (00,10,11) and (00,11,01)
      drawTexturedTriangle(
        ctx,
        img,
        s00.x,
        s00.y,
        s10.x,
        s10.y,
        s11.x,
        s11.y,
        originX + d00.x,
        originY + d00.y,
        originX + d10.x,
        originY + d10.y,
        originX + d11.x,
        originY + d11.y,
      )
      drawTexturedTriangle(
        ctx,
        img,
        s00.x,
        s00.y,
        s11.x,
        s11.y,
        s01.x,
        s01.y,
        originX + d00.x,
        originY + d00.y,
        originX + d11.x,
        originY + d11.y,
        originX + d01.x,
        originY + d01.y,
      )
    }
  }
  ctx.restore()
}

/**
 * Affine-texture a triangle. Based on the standard canvas triangle mapping trick:
 * transform so destination triangle maps from unit source triangle over the image crop.
 */
function drawTexturedTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  sx0: number,
  sy0: number,
  sx1: number,
  sy1: number,
  sx2: number,
  sy2: number,
  dx0: number,
  dy0: number,
  dx1: number,
  dy1: number,
  dx2: number,
  dy2: number,
): void {
  // Skip degenerate
  const sArea = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0)
  const dArea = (dx1 - dx0) * (dy2 - dy0) - (dx2 - dx0) * (dy1 - dy0)
  if (Math.abs(sArea) < 1e-6 || Math.abs(dArea) < 1e-6) return

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(dx0, dy0)
  ctx.lineTo(dx1, dy1)
  ctx.lineTo(dx2, dy2)
  ctx.closePath()
  ctx.clip()

  // Solve affine: [dx]   [a c e] [sx]
  //               [dy] = [b d f] [sy]
  //               [1 ]   [0 0 1] [1 ]
  // from the three corners.
  const denom =
    sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1)
  if (Math.abs(denom) < 1e-9) {
    ctx.restore()
    return
  }

  const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom
  const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom
  const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom
  const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom
  const e =
    (dx0 * (sx1 * sy2 - sx2 * sy1) +
      dx1 * (sx2 * sy0 - sx0 * sy2) +
      dx2 * (sx0 * sy1 - sx1 * sy0)) /
    denom
  const f =
    (dy0 * (sx1 * sy2 - sx2 * sy1) +
      dy1 * (sx2 * sy0 - sx0 * sy2) +
      dy2 * (sx0 * sy1 - sx1 * sy0)) /
    denom

  // Multiply into current CTM (keeps DPR / scene scale).
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(img, 0, 0)
  ctx.restore()
}

/** Apply 3×3 row-major homography: image → hex-local. */
export function applyHomography(
  H: number[],
  x: number,
  y: number,
): { x: number; y: number } {
  const a = H[0]!,
    b = H[1]!,
    c = H[2]!,
    d = H[3]!,
    e = H[4]!,
    f = H[5]!,
    g = H[6]!,
    h = H[7]!,
    i = H[8]!
  const w = g * x + h * y + i
  if (!(Math.abs(w) > 1e-12)) return { x: 0, y: 0 }
  return { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w }
}

/**
 * Build a regular image→hex-local mesh from a 3×3 perspective matrix.
 * Used when only `perspective` is present (no pre-baked TPS mesh).
 */
export function meshFromPerspective(
  H: number[],
  imageWidth: number,
  imageHeight: number,
  cols = 16,
  rows = 12,
): WarpMesh {
  const src: number[] = []
  const dst: number[] = []
  for (let j = 0; j < rows; j++) {
    const v = j / (rows - 1)
    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1)
      const ix = u * imageWidth
      const iy = v * imageHeight
      const p = applyHomography(H, ix, iy)
      src.push(ix, iy)
      dst.push(p.x, p.y)
    }
  }
  return { cols, rows, src, dst }
}

export function isWarpMesh(raw: unknown): raw is WarpMesh {
  if (!raw || typeof raw !== 'object') return false
  const o = raw as Record<string, unknown>
  return (
    typeof o.cols === 'number' &&
    typeof o.rows === 'number' &&
    Array.isArray(o.src) &&
    Array.isArray(o.dst) &&
    o.cols >= 2 &&
    o.rows >= 2 &&
    o.src.length >= o.cols * o.rows * 2 &&
    o.dst.length >= o.cols * o.rows * 2
  )
}
