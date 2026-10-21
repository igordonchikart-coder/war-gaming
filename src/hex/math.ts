import type { Axial } from './types'

/**
 * Pointy-top orientation (Red Blob Games).
 * Stored (q, r) are **odd-r** offset coordinates: horizontal rows, odd rows
 * shoved right — the usual rectangular layout for pointy-top hexes.
 *
 * Pixel / corner formulas match https://www.redblobgames.com/grids/hexagons/
 * (“pointy” orientation + “odd-r” offset).
 */

/** Pointy-top odd-r: pixel center from offset (col=q, row=r). */
export function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (q + 0.5 * (r & 1))
  const y = size * ((3 / 2) * r)
  return { x, y }
}

/** Six corner points of a pointy-top hex centered at (cx, cy). */
export function hexCorners(cx: number, cy: number, size: number): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 6; i++) {
    // Pointy-top: first corner at -30° (vertex on top in canvas y-down).
    const angle = (Math.PI / 180) * (60 * i - 30)
    corners.push({
      x: cx + size * Math.cos(angle),
      y: cy + size * Math.sin(angle),
    })
  }
  return corners
}

function cubeRound(q: number, r: number): Axial {
  const s = -q - r
  let rq = Math.round(q)
  let rr = Math.round(r)
  const rs = Math.round(s)

  const qDiff = Math.abs(rq - q)
  const rDiff = Math.abs(rr - r)
  const sDiff = Math.abs(rs - s)

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs
  } else if (rDiff > sDiff) {
    rr = -rq - rs
  }

  return { q: rq, r: rr }
}

/** Cube/axial direction steps (same for flat and pointy). */
export const AXIAL_DIRECTIONS: ReadonlyArray<Axial> = [
  { q: +1, r: 0 },
  { q: +1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: +1 },
  { q: 0, r: +1 },
]

/** odd-r offset → axial. */
export function oddrToAxial(col: number, row: number): Axial {
  const q = col - (row - (row & 1)) / 2
  const r = row
  return { q, r }
}

/** axial → odd-r offset. */
export function axialToOddr(q: number, r: number): Axial {
  const col = q + (r - (r & 1)) / 2
  const row = r
  return { q: col, r: row }
}

/**
 * Pointy-top odd-r neighbors in offset (col, row) space.
 * Row parity changes the ±col deltas (Red Blob Games).
 */
export function oddrNeighbors(col: number, row: number): Axial[] {
  const even = [
    [+1, 0],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, +1],
    [0, +1],
  ] as const
  const odd = [
    [+1, 0],
    [+1, -1],
    [0, -1],
    [-1, 0],
    [0, +1],
    [+1, +1],
  ] as const
  const deltas = row & 1 ? odd : even
  return deltas.map(([dq, dr]) => ({ q: col + dq, r: row + dr }))
}

/** Pixel (relative to map origin) → nearest odd-r offset hex. */
export function pixelToAxial(x: number, y: number, size: number): Axial {
  // Pointy-top pixel → fractional axial, round, then to odd-r offset.
  const fq = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size
  const fr = ((2 / 3) * y) / size
  const axial = cubeRound(fq, fr)
  return axialToOddr(axial.q, axial.r)
}

export function tileKey(q: number, r: number): string {
  return `${q},${r}`
}
