import { useEffect, useRef, type MouseEvent } from 'react'
import { axialToPixel, hexCorners, pixelToAxial } from '../hex/math'
import { getTerrain, inBounds } from '../hex/map'
import {
  type LoadedMapImage,
  type MapImageAlign,
  type MapLayerMode,
} from '../hex/mapImage'
import { TERRAIN_COLORS, type MapData, type Terrain } from '../hex/types'

/**
 * Center-to-vertex radius (pointy-top: height = 2*size, width = √3*size).
 * Tuned with DEFAULT_MAP_SIZE so fit-width underlay sits closer to Hanko pitch;
 * fine-tune further via map size + align UI.
 */
const HEX_SIZE = 20
const PADDING = 24

interface HexCanvasProps {
  map: MapData
  selectedTerrain: Terrain
  hover: { q: number; r: number } | null
  onHover: (hex: { q: number; r: number } | null) => void
  onPaint: (q: number, r: number) => void
  mapImages?: LoadedMapImage[]
  layerMode?: MapLayerMode
  align?: MapImageAlign
  /** Opacity of terrain fill when both map and grid are shown (0–1). */
  gridOpacity?: number
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

/** Hex field bounding box in canvas pixels (centers ± hex size). */
function hexFieldBounds(
  map: MapData,
  originX: number,
  originY: number,
): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const { x, y } = axialToPixel(q, r, HEX_SIZE)
      const cx = x + originX
      const cy = y + originY
      minX = Math.min(minX, cx - HEX_SIZE)
      maxX = Math.max(maxX, cx + HEX_SIZE)
      minY = Math.min(minY, cy - HEX_SIZE)
      maxY = Math.max(maxY, cy + HEX_SIZE)
    }
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function drawMapUnderlay(
  ctx: CanvasRenderingContext2D,
  images: LoadedMapImage[],
  field: { x: number; y: number; width: number; height: number },
  align: MapImageAlign,
) {
  if (images.length === 0) return

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Primary image aligned to hex field; extra tiles drawn sequentially to the right.
  let cursorX = field.x + align.offsetX
  const baseY = field.y + align.offsetY

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!
    const fitScale = field.width / img.naturalWidth
    const scale = align.fitWidth ? fitScale * align.scale : align.scale
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    const dx = i === 0 ? cursorX : cursorX
    const dy = baseY
    ctx.drawImage(img.source, dx, dy, dw, dh)
    cursorX += dw
  }
}

export function HexCanvas({
  map,
  selectedTerrain,
  hover,
  onHover,
  onPaint,
  mapImages = [],
  layerMode = 'both',
  align = { scale: 1, offsetX: 0, offsetY: 0, fitWidth: true },
  gridOpacity = 0.45,
}: HexCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const paintingRef = useRef(false)
  const layout = mapPixelSize(map)
  const showMap = layerMode === 'map' || layerMode === 'both'
  const showGrid = layerMode === 'grid' || layerMode === 'both'

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

    const field = hexFieldBounds(map, layout.originX, layout.originY)

    if (showMap && mapImages.length > 0) {
      drawMapUnderlay(ctx, mapImages, field, align)
    }

    if (showGrid) {
      const fillAlpha = showMap && mapImages.length > 0 ? gridOpacity : 1

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

          if (fillAlpha > 0) {
            ctx.globalAlpha = fillAlpha
            ctx.fillStyle = TERRAIN_COLORS[terrain]
            ctx.fill()
            ctx.globalAlpha = 1
          }

          const isHover = hover?.q === q && hover?.r === r
          ctx.strokeStyle = isHover ? '#f5f0e6' : 'rgba(0,0,0,0.45)'
          ctx.lineWidth = isHover ? 2 : 1
          ctx.stroke()

          if (HEX_SIZE >= 22) {
            ctx.fillStyle = showMap ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)'
            ctx.font = '10px ui-monospace, monospace'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(`${q},${r}`, cx, cy)
          }
        }
      }
    } else if (showMap && hover) {
      // Outline hovered hex even in map-only mode for painting feedback
      const { x, y } = axialToPixel(hover.q, hover.r, HEX_SIZE)
      const cx = x + layout.originX
      const cy = y + layout.originY
      const corners = hexCorners(cx, cy, HEX_SIZE - 1)
      ctx.beginPath()
      ctx.moveTo(corners[0]!.x, corners[0]!.y)
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i]!.x, corners[i]!.y)
      }
      ctx.closePath()
      ctx.strokeStyle = '#f5f0e6'
      ctx.lineWidth = 2
      ctx.stroke()
    }
  }, [map, hover, layout, mapImages, layerMode, align, gridOpacity, showMap, showGrid])

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
