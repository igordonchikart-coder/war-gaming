import type { Axial } from './types'

/**
 * Flat-top orientation (Red Blob Games) — horizontal edges on top and bottom.
 * Matches Map2.png printed grid (and the prior Hanko sheet).
 *
 * Stored (q, r) are **odd-q** offset coordinates: vertical columns, odd columns
 * shoved down — the usual rectangular layout for flat-top hexes
 * (`index = r * width + q`).
 *
 * Pixel / corner formulas match https://www.redblobgames.com/grids/hexagons/
 * (“flat” orientation + “odd-q” offset).
 */

/** Flat-top odd-q: pixel center from offset (col=q, row=r). */
export function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * ((3 / 2) * q)
  const y = size * Math.sqrt(3) * (r + 0.5 * (q & 1))
  return { x, y }
}

/** Six corner points of a flat-top hex centered at (cx, cy). */
export function hexCorners(cx: number, cy: number, size: number): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = []
  for (let i = 0; i < 6; i++) {
    // Flat-top: first corner at 0° → left/right vertices; top & bottom edges are horizontal.
    const angle = (Math.PI / 180) * (60 * i)
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

/** odd-q offset → axial. */
export function oddqToAxial(col: number, row: number): Axial {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return { q, r }
}

/** axial → odd-q offset. */
export function axialToOddq(q: number, r: number): Axial {
  const col = q
  const row = r + (q - (q & 1)) / 2
  return { q: col, r: row }
}

/**
 * Flat-top odd-q neighbors in offset (col, row) space.
 * Column parity changes the ±row deltas (Red Blob Games).
 */
export function oddqNeighbors(col: number, row: number): Axial[] {
  const even = [
    [+1, 0],
    [+1, -1],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [0, +1],
  ] as const
  const odd = [
    [+1, +1],
    [+1, 0],
    [0, -1],
    [-1, 0],
    [-1, +1],
    [0, +1],
  ] as const
  const deltas = col & 1 ? odd : even
  return deltas.map(([dq, dr]) => ({ q: col + dq, r: row + dr }))
}

/** Pixel (relative to map origin) → nearest odd-q offset hex. */
export function pixelToAxial(x: number, y: number, size: number): Axial {
  // Flat-top pixel → fractional axial, round, then to odd-q offset.
  const fq = ((2 / 3) * x) / size
  const fr = ((-1 / 3) * x + (Math.sqrt(3) / 3) * y) / size
  const axial = cubeRound(fq, fr)
  return axialToOddq(axial.q, axial.r)
}

export function tileKey(q: number, r: number): string {
  return `${q},${r}`
}
