import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { axialToPixel, hexCorners, pixelToAxial } from '../hex/math'
import { getTerrain, inBounds } from '../hex/map'
import {
  type LoadedMapImage,
  type MapImageAlign,
  type MapLayerMode,
} from '../hex/mapImage'
import { TERRAIN_COLORS, type MapData, type Terrain } from '../hex/types'

/**
 * Center-to-vertex radius (flat-top: width = 2*size, height = √3*size).
 * Tuned with DEFAULT_MAP_SIZE so fit-width underlay sits closer to Hanko pitch;
 * fine-tune further via map size + align UI.
 */
const HEX_SIZE = 22
const PADDING = 24
const MIN_VIEW_SCALE = 0.25
const MAX_VIEW_SCALE = 4

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
  /** Called when view zoom changes (pinch / ctrl+wheel). */
  onViewScaleChange?: (scale: number) => void
}

function clampViewScale(n: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, n))
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

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null
  while (node) {
    const style = getComputedStyle(node)
    const overflow = style.overflow + style.overflowX + style.overflowY
    if (/(auto|scroll)/.test(overflow)) return node
    node = node.parentElement
  }
  return null
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
  onViewScaleChange,
}: HexCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const paintingRef = useRef(false)
  const viewScaleRef = useRef(1)
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const [viewScale, setViewScale] = useState(1)
  const layout = mapPixelSize(map)
  const showMap = layerMode === 'map' || layerMode === 'both'
  const showGrid = layerMode === 'grid' || layerMode === 'both'

  useEffect(() => {
    viewScaleRef.current = viewScale
    onViewScaleChange?.(viewScale)
  }, [viewScale, onViewScaleChange])

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

          // Labels = odd-q offset indices used by paint/hit-test (0-based).
          if (HEX_SIZE >= 18) {
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

  /** Zoom whole scene (underlay + grid) keeping the point under the cursor fixed. */
  function zoomTo(clientX: number, clientY: number, nextScale: number) {
    const spacer = spacerRef.current
    const scrollParent = findScrollParent(spacer)
    const oldScale = viewScaleRef.current
    const clamped = clampViewScale(nextScale)
    if (!spacer || Math.abs(clamped - oldScale) < 1e-6) return

    const spacerRect = spacer.getBoundingClientRect()
    const parentRect = scrollParent?.getBoundingClientRect()
    const offsetX = clientX - spacerRect.left
    const offsetY = clientY - spacerRect.top
    const contentX = offsetX / oldScale
    const contentY = offsetY / oldScale

    viewScaleRef.current = clamped
    setViewScale(clamped)

    requestAnimationFrame(() => {
      if (!scrollParent || !parentRect) return
      const newLeft = spacer.offsetLeft + contentX * clamped - (clientX - parentRect.left)
      const newTop = spacer.offsetTop + contentY * clamped - (clientY - parentRect.top)
      scrollParent.scrollLeft = Math.max(0, newLeft)
      scrollParent.scrollTop = Math.max(0, newTop)
    })
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onWheel = (e: WheelEvent) => {
      // Trackpad pinch on Mac synthesizes wheel + ctrlKey; also support ctrl/meta+wheel.
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.01)
      zoomTo(e.clientX, e.clientY, viewScaleRef.current * factor)
    }

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchRef.current = {
          dist: touchDistance(e.touches[0]!, e.touches[1]!),
          scale: viewScaleRef.current,
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return
      e.preventDefault()
      const a = e.touches[0]!
      const b = e.touches[1]!
      const dist = touchDistance(a, b)
      if (pinchRef.current.dist < 1) return
      const midX = (a.clientX + b.clientX) / 2
      const midY = (a.clientY + b.clientY) / 2
      zoomTo(midX, midY, pinchRef.current.scale * (dist / pinchRef.current.dist))
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    canvas.addEventListener('touchcancel', onTouchEnd)
    return () => {
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
      canvas.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [layout.width, layout.height])

  function eventToHex(e: MouseEvent<HTMLCanvasElement>): { q: number; r: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    // Map through CSS scale so paint/hit-test stay aligned with the zoomed scene.
    const x = ((e.clientX - rect.left) / rect.width) * layout.width - layout.originX
    const y = ((e.clientY - rect.top) / rect.height) * layout.height - layout.originY
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
    <div
      ref={spacerRef}
      className="hex-canvas-spacer"
      style={{
        width: layout.width * viewScale,
        height: layout.height * viewScale,
        position: 'relative',
      }}
    >
      <canvas
        ref={canvasRef}
        className="hex-canvas"
        aria-label="Гекс-карта"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: layout.width,
          height: layout.height,
          transform: `scale(${viewScale})`,
          transformOrigin: '0 0',
          touchAction: 'none',
        }}
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
    </div>
  )
}

export { MIN_VIEW_SCALE, MAX_VIEW_SCALE }
