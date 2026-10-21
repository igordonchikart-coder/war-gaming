import { useEffect, useRef, type MouseEvent } from 'react'
import { axialToPixel, hexCorners, pixelToAxial } from '../hex/math'
import { getTerrain, inBounds } from '../hex/map'
import { TERRAIN_COLORS, type MapData, type Terrain } from '../hex/types'

const HEX_SIZE = 28
const PADDING = 24

interface HexCanvasProps {
  map: MapData
  selectedTerrain: Terrain
  hover: { q: number; r: number } | null
  onHover: (hex: { q: number; r: number } | null) => void
  onPaint: (q: number, r: number) => void
}

function mapPixelSize(map: MapData): { width: number; height: number; originX: number; originY: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const { x, y } = axialToPixel(q, r, HEX_SIZE)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }

  const originX = PADDING - minX + HEX_SIZE
  const originY = PADDING - minY + HEX_SIZE
  const width = maxX - minX + HEX_SIZE * 2 + PADDING * 2
  const height = maxY - minY + HEX_SIZE * 2 + PADDING * 2
  return { width, height, originX, originY }
}

export function HexCanvas({ map, selectedTerrain, hover, onHover, onPaint }: HexCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paintingRef = useRef(false)
  const layout = mapPixelSize(map)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(layout.width * dpr)
    canvas.height = Math.floor(layout.height * dpr)
    canvas.style.width = `${layout.width}px`
    canvas.style.height = `${layout.height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = '#1a1f24'
    ctx.fillRect(0, 0, layout.width, layout.height)

    for (let r = 0; r < map.height; r++) {
      for (let q = 0; q < map.width; q++) {
        const terrain = getTerrain(map, q, r)!
        const { x, y } = axialToPixel(q, r, HEX_SIZE)
        const cx = x + layout.originX
        const cy = y + layout.originY
        const corners = hexCorners(cx, cy, HEX_SIZE - 1)

        ctx.beginPath()
        ctx.moveTo(corners[0]!.x, corners[0]!.y)
        for (let i = 1; i < corners.length; i++) {
          ctx.lineTo(corners[i]!.x, corners[i]!.y)
        }
        ctx.closePath()
        ctx.fillStyle = TERRAIN_COLORS[terrain]
        ctx.fill()

        const isHover = hover?.q === q && hover?.r === r
        ctx.strokeStyle = isHover ? '#f5f0e6' : 'rgba(0,0,0,0.35)'
        ctx.lineWidth = isHover ? 2 : 1
        ctx.stroke()

        if (HEX_SIZE >= 22) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)'
          ctx.font = '10px ui-monospace, monospace'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(`${q},${r}`, cx, cy)
        }
      }
    }
  }, [map, hover, layout])

  function eventToHex(e: MouseEvent<HTMLCanvasElement>): { q: number; r: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left - layout.originX
    const y = e.clientY - rect.top - layout.originY
    const hex = pixelToAxial(x, y, HEX_SIZE)
    if (!inBounds(map, hex.q, hex.r)) return null
    return hex
  }

  function paintAt(e: MouseEvent<HTMLCanvasElement>) {
    const hex = eventToHex(e)
    if (!hex) return
    onPaint(hex.q, hex.r)
  }

  return (
    <canvas
      ref={canvasRef}
      className="hex-canvas"
      aria-label="Гекс-карта"
      onMouseDown={(e) => {
        if (e.button !== 0) return
        paintingRef.current = true
        paintAt(e)
      }}
      onMouseUp={() => {
        paintingRef.current = false
      }}
      onMouseLeave={() => {
        paintingRef.current = false
        onHover(null)
      }}
      onMouseMove={(e) => {
        const hex = eventToHex(e)
        onHover(hex)
        if (paintingRef.current && hex) {
          onPaint(hex.q, hex.r)
        }
      }}
      title={`Кисть: ${selectedTerrain}`}
    />
  )
}
