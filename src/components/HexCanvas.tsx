import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
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

export type CanvasTool = 'paint' | 'pan'

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
  /** Controlled scene zoom (pinch / ctrl+wheel). */
  viewScale?: number
  /** Called when view zoom changes (pinch / ctrl+wheel / fit). */
  onViewScaleChange?: (scale: number) => void
  /** Active tool: paint brush or hand (pan). */
  tool?: CanvasTool
  /**
   * When true with align.fitWidth, scene zoom is set so map width matches
   * the viewport (recalculated on resize).
   */
  fitViewportWidth?: boolean
}

function clampViewScale(n: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, n))
}

export function mapPixelSize(map: MapData): {
  width: number
  height: number
  originX: number
  originY: number
} {
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

  // Primary image aligned to hex field; extra tiles drawn sequentially to the right.
  // Source stays at natural pixels (no preload downscale). Fit/zoom only via draw + CSS.
  let cursorX = field.x + align.offsetX
  const baseY = field.y + align.offsetY

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!
    const fitScale = field.width / img.naturalWidth
    const scale = align.fitWidth ? fitScale * align.scale : align.scale
    const dw = img.naturalWidth * scale
    const dh = img.naturalHeight * scale
    // Soften only when shrinking into the hex field; keep sharp when 1:1 or upscaling.
    const shrinking = dw < img.naturalWidth - 0.5 || dh < img.naturalHeight - 0.5
    ctx.imageSmoothingEnabled = shrinking
    if (shrinking) ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, 0, 0, img.naturalWidth, img.naturalHeight, cursorX, baseY, dw, dh)
    cursorX += dw
  }
}

function touchDistance(a: Touch, b: Touch): number {
  const dx = a.clientX - b.clientX
  const dy = a.clientY - b.clientY
  return Math.hypot(dx, dy)
}

function touchMidpoint(a: Touch, b: Touch): { x: number; y: number } {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
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
  viewScale: viewScaleProp,
  onViewScaleChange,
  tool = 'paint',
  fitViewportWidth = true,
}: HexCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const paintingRef = useRef(false)
  const viewScaleRef = useRef(1)
  const spaceHeldRef = useRef(false)
  const panRef = useRef<{
    pointerId: number
    lastX: number
    lastY: number
  } | null>(null)
  const pinchRef = useRef<{
    dist: number
    scale: number
    midX: number
    midY: number
  } | null>(null)
  const [internalViewScale, setInternalViewScale] = useState(1)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [panning, setPanning] = useState(false)
  const viewScale = viewScaleProp ?? internalViewScale
  const layout = mapPixelSize(map)
  const showMap = layerMode === 'map' || layerMode === 'both'
  const showGrid = layerMode === 'grid' || layerMode === 'both'
  const wantPanCursor = tool === 'pan' || spaceHeld || panning

  useEffect(() => {
    viewScaleRef.current = viewScale
  }, [viewScale])

  function setViewScale(next: number) {
    const clamped = clampViewScale(next)
    viewScaleRef.current = clamped
    if (viewScaleProp === undefined) setInternalViewScale(clamped)
    onViewScaleChange?.(clamped)
  }

  /** Fit scene so map width matches the viewport content box. */
  function fitToViewportWidth() {
    const viewport = viewportRef.current
    if (!viewport || layout.width <= 0) return
    const next = clampViewScale(viewport.clientWidth / layout.width)
    if (Math.abs(next - viewScaleRef.current) < 1e-4) return
    setViewScale(next)
  }

  // Fit width → scene fills canvas area; recalc on resize / map size change.
  useEffect(() => {
    if (!fitViewportWidth || !align.fitWidth) return
    const viewport = viewportRef.current
    if (!viewport) return

    fitToViewportWidth()

    const ro = new ResizeObserver(() => {
      fitToViewportWidth()
    })
    ro.observe(viewport)
    return () => ro.disconnect()
    // layout.width / fitWidth gate the effect; fit reads viewport live.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [fitViewportWidth, align.fitWidth, layout.width, map.width, map.height])

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
          // Full HEX_SIZE — flat-top centers already use classic spacing; no inset/gap.
          const corners = hexCorners(cx, cy, HEX_SIZE)

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
          // Stroke sits on the shared edge (no radius shrink); cells meet edge-to-edge.
          ctx.lineWidth = isHover ? 2 : 1
          ctx.lineJoin = 'miter'
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
      const corners = hexCorners(cx, cy, HEX_SIZE)
      ctx.beginPath()
      ctx.moveTo(corners[0]!.x, corners[0]!.y)
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i]!.x, corners[i]!.y)
      }
      ctx.closePath()
      ctx.strokeStyle = '#f5f0e6'
      ctx.lineWidth = 2
      ctx.lineJoin = 'miter'
      ctx.stroke()
    }
  }, [map, hover, layout, mapImages, layerMode, align, gridOpacity, showMap, showGrid])

  /** Zoom whole scene (underlay + grid) keeping the point under the cursor fixed. */
  function zoomTo(clientX: number, clientY: number, nextScale: number) {
    const viewport = viewportRef.current
    const spacer = spacerRef.current
    const oldScale = viewScaleRef.current
    const clamped = clampViewScale(nextScale)
    if (!spacer || !viewport || Math.abs(clamped - oldScale) < 1e-6) return

    const spacerRect = spacer.getBoundingClientRect()
    const parentRect = viewport.getBoundingClientRect()
    const offsetX = clientX - spacerRect.left
    const offsetY = clientY - spacerRect.top
    const contentX = offsetX / oldScale
    const contentY = offsetY / oldScale

    setViewScale(clamped)

    requestAnimationFrame(() => {
      const newLeft = spacer.offsetLeft + contentX * clamped - (clientX - parentRect.left)
      const newTop = spacer.offsetTop + contentY * clamped - (clientY - parentRect.top)
      viewport.scrollLeft = Math.max(0, newLeft)
      viewport.scrollTop = Math.max(0, newTop)
    })
  }

  function panBy(dx: number, dy: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    viewport.scrollLeft -= dx
    viewport.scrollTop -= dy
  }

  // Space = temporary pan (does not steal typing from number inputs).
  useEffect(() => {
    const isTypingTarget = (t: EventTarget | null) => {
      if (!(t instanceof HTMLElement)) return false
      const tag = t.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      if (isTypingTarget(e.target)) return
      e.preventDefault()
      spaceHeldRef.current = true
      setSpaceHeld(true)
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      setSpaceHeld(false)
      if (panRef.current) {
        panRef.current = null
        setPanning(false)
      }
    }
    const onBlur = () => {
      spaceHeldRef.current = false
      setSpaceHeld(false)
      panRef.current = null
      setPanning(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // Wheel zoom (pinch / ctrl) + trackpad pan fallback via scroll deltas.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onWheel = (e: WheelEvent) => {
      // Trackpad pinch on Mac synthesizes wheel + ctrlKey; also support ctrl/meta+wheel.
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const factor = Math.exp(-e.deltaY * 0.01)
        zoomTo(e.clientX, e.clientY, viewScaleRef.current * factor)
        return
      }
      // Two-finger trackpad pan: apply deltas ourselves so the canvas under the
      // cursor does not swallow scroll (touch-action: none / nested scroll).
      if (e.deltaX !== 0 || e.deltaY !== 0) {
        e.preventDefault()
        panBy(-e.deltaX, -e.deltaY)
      }
    }

    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
    // zoomTo/panBy close over refs; rebind when layout size changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [layout.width, layout.height])

  // Touch: two-finger pinch + pan together.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        paintingRef.current = false
        const a = e.touches[0]!
        const b = e.touches[1]!
        const mid = touchMidpoint(a, b)
        pinchRef.current = {
          dist: touchDistance(a, b),
          scale: viewScaleRef.current,
          midX: mid.x,
          midY: mid.y,
        }
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return
      e.preventDefault()
      const a = e.touches[0]!
      const b = e.touches[1]!
      const dist = touchDistance(a, b)
      const mid = touchMidpoint(a, b)
      const prev = pinchRef.current

      // Pan by midpoint delta first (scroll), then zoom around new midpoint.
      panBy(mid.x - prev.midX, mid.y - prev.midY)

      if (prev.dist >= 1) {
        zoomTo(mid.x, mid.y, prev.scale * (dist / prev.dist))
      }

      pinchRef.current = {
        dist,
        scale: viewScaleRef.current,
        midX: mid.x,
        midY: mid.y,
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null
    }

    viewport.addEventListener('touchstart', onTouchStart, { passive: true })
    viewport.addEventListener('touchmove', onTouchMove, { passive: false })
    viewport.addEventListener('touchend', onTouchEnd)
    viewport.addEventListener('touchcancel', onTouchEnd)
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart)
      viewport.removeEventListener('touchmove', onTouchMove)
      viewport.removeEventListener('touchend', onTouchEnd)
      viewport.removeEventListener('touchcancel', onTouchEnd)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [layout.width, layout.height])

  function eventToHex(e: { clientX: number; clientY: number }): { q: number; r: number } | null {
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

  function paintAt(e: { clientX: number; clientY: number }) {
    const hex = eventToHex(e)
    if (!hex) return
    onPaint(hex.q, hex.r)
  }

  function shouldPan(e: ReactMouseEvent | PointerEvent): boolean {
    if (e.button === 1) return true // middle
    if (tool === 'pan' && e.button === 0) return true
    if (spaceHeldRef.current && e.button === 0) return true
    return false
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (shouldPan(e)) {
      e.preventDefault()
      paintingRef.current = false
      panRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY }
      setPanning(true)
      canvasRef.current?.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0 || tool !== 'paint') return
    paintingRef.current = true
    paintAt(e)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const pan = panRef.current
    if (pan && pan.pointerId === e.pointerId) {
      panBy(e.clientX - pan.lastX, e.clientY - pan.lastY)
      pan.lastX = e.clientX
      pan.lastY = e.clientY
      return
    }
    if (tool !== 'paint' || spaceHeldRef.current) {
      onHover(null)
      return
    }
    const hex = eventToHex(e)
    onHover(hex)
    if (paintingRef.current && hex) {
      onPaint(hex.q, hex.r)
    }
  }

  function endPan(e: React.PointerEvent<HTMLCanvasElement>) {
    if (panRef.current?.pointerId === e.pointerId) {
      panRef.current = null
      setPanning(false)
      try {
        canvasRef.current?.releasePointerCapture(e.pointerId)
      } catch {
        // already released
      }
    }
    paintingRef.current = false
  }

  const cursor = panning ? 'grabbing' : wantPanCursor ? 'grab' : 'crosshair'

  return (
    <div ref={viewportRef} className="hex-viewport" aria-label="Область карты">
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
            cursor,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          onPointerLeave={() => {
            if (!panRef.current) {
              paintingRef.current = false
              onHover(null)
            }
          }}
          onAuxClick={(e) => {
            // Block middle-click default (autoscroll / open tab) while panning.
            if (e.button === 1) e.preventDefault()
          }}
          onContextMenu={(e) => {
            if (tool === 'pan' || spaceHeldRef.current) e.preventDefault()
          }}
          title={
            tool === 'pan' || spaceHeld
              ? 'Рука: перетащите карту'
              : `Кисть: ${selectedTerrain} · Space/СКМ — pan · щипок — зум`
          }
        />
      </div>
    </div>
  )
}

export { MIN_VIEW_SCALE, MAX_VIEW_SCALE }
