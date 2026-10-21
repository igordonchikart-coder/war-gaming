import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { HEX_SIZE, effectiveUnderlayScales } from '../hex/calibrate'
import { axialToPixel, hexCorners, pixelToAxial } from '../hex/math'
import { getTerrain, inBounds } from '../hex/map'
import {
  type LoadedMapImage,
  type MapImageAlign,
  type MapLayerMode,
} from '../hex/mapImage'
import {
  LABEL_CELL_LIMIT,
  TERRAIN_COLORS,
  type MapData,
  type Terrain,
  type ViewportFitMode,
} from '../hex/types'

const PADDING = 24
/** Low enough that contain-fit of a tall/wide sheet still fits small viewports. */
const MIN_VIEW_SCALE = 0.05
const MAX_VIEW_SCALE = 4

export type CanvasTool = 'paint' | 'pan'

/** 2-point underlay calibration: map clicks then matching overlay hexes. */
export type CalibPhase = 'map1' | 'map2' | 'hex1' | 'hex2'

export interface CalibMapClick {
  /** Canvas-local coords (relative to hex origin, same as axialToPixel). */
  x: number
  y: number
}

export interface CalibSessionMarkers {
  map1?: CalibMapClick | null
  map2?: CalibMapClick | null
  hex1?: { q: number; r: number } | null
  hex2?: { q: number; r: number } | null
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

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
   * Viewport framing of the map sheet:
   * - contain: entire underlay (or scene) visible, letterbox if needed
   * - width: fit underlay/scene width to viewport
   * - free: manual zoom (pinch / slider); no auto-refit on resize
   */
  viewportFit?: ViewportFitMode
  /** Fired when the user leaves an auto-fit mode (pinch / manual zoom). */
  onViewportFitChange?: (mode: ViewportFitMode) => void
  /** Active 2-point calibration step (disables paint). */
  calibPhase?: CalibPhase | null
  /** Markers for in-progress calibration. */
  calibMarkers?: CalibSessionMarkers
  /** Printed-grid click in canvas-local space (map1 / map2). */
  onCalibMapClick?: (point: CalibMapClick) => void
  /** Overlay hex pick (hex1 / hex2). */
  onCalibHexClick?: (hex: { q: number; r: number }) => void
}

function clampViewScale(n: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, n))
}

/** Flat-top odd-q center extents without O(W×H) scan. */
function oddqCenterExtents(map: MapData): { minX: number; maxX: number; minY: number; maxY: number } {
  const minX = 0
  const maxX = map.width <= 1 ? 0 : HEX_SIZE * 1.5 * (map.width - 1)
  const minY = 0
  const oddBump = map.width > 1 ? 0.5 : 0
  const maxY = HEX_SIZE * Math.sqrt(3) * (map.height - 1 + oddBump)
  return { minX, maxX, minY, maxY }
}

export function mapPixelSize(map: MapData): {
  width: number
  height: number
  originX: number
  originY: number
} {
  const { minX, maxX, minY, maxY } = oddqCenterExtents(map)
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
): Rect {
  const { minX, maxX, minY, maxY } = oddqCenterExtents(map)
  return {
    x: minX + originX - HEX_SIZE,
    y: minY + originY - HEX_SIZE,
    width: maxX - minX + HEX_SIZE * 2,
    height: maxY - minY + HEX_SIZE * 2,
  }
}

function drawHoverOutline(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  hover: { q: number; r: number },
  originX: number,
  originY: number,
) {
  if (!inBounds(map, hover.q, hover.r)) return
  const { x, y } = axialToPixel(hover.q, hover.r, HEX_SIZE)
  const cx = x + originX
  const cy = y + originY
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

/** Paint terrain fills, strokes, and optional q,r labels (no hover). */
function paintHexGrid(
  ctx: CanvasRenderingContext2D,
  map: MapData,
  originX: number,
  originY: number,
  fillAlpha: number,
  showMap: boolean,
) {
  const cellCount = map.width * map.height
  const showLabels = cellCount <= LABEL_CELL_LIMIT && HEX_SIZE >= 18

  for (let r = 0; r < map.height; r++) {
    for (let q = 0; q < map.width; q++) {
      const terrain = getTerrain(map, q, r)!
      const { x, y } = axialToPixel(q, r, HEX_SIZE)
      const cx = x + originX
      const cy = y + originY
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

      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.lineWidth = 1
      ctx.lineJoin = 'miter'
      ctx.stroke()

      if (showLabels) {
        ctx.fillStyle = showMap ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.45)'
        ctx.font = '10px ui-monospace, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(`${q},${r}`, cx, cy)
      }
    }
  }
}

/** Pixel rect of the drawn underlay (may extend past the hex field). */
function underlayRect(
  images: LoadedMapImage[],
  field: Rect,
  align: MapImageAlign,
): Rect | null {
  if (images.length === 0) return null

  let cursorX = field.x + align.offsetX
  const baseY = field.y + align.offsetY
  let minX = cursorX
  let minY = baseY
  let maxX = cursorX
  let maxY = baseY

  for (const img of images) {
    const { sx, sy } = effectiveUnderlayScales(align, field.width, img.naturalWidth)
    const dw = img.naturalWidth * sx
    const dh = img.naturalHeight * sy
    minX = Math.min(minX, cursorX)
    minY = Math.min(minY, baseY)
    maxX = Math.max(maxX, cursorX + dw)
    maxY = Math.max(maxY, baseY + dh)
    cursorX += dw
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Scene = hex bitmap ∪ underlay. Expands/shifts so the full map sheet is on-canvas
 * even when art is larger than the hex grid or offset outside it.
 */
function computeSceneLayout(
  map: MapData,
  images: LoadedMapImage[],
  align: MapImageAlign,
): {
  width: number
  height: number
  originX: number
  originY: number
  field: Rect
  underlay: Rect | null
} {
  const hex = mapPixelSize(map)
  const field = hexFieldBounds(map, hex.originX, hex.originY)
  const underlay = underlayRect(images, field, align)

  let minX = 0
  let minY = 0
  let maxX = hex.width
  let maxY = hex.height

  if (underlay) {
    minX = Math.min(minX, underlay.x)
    minY = Math.min(minY, underlay.y)
    maxX = Math.max(maxX, underlay.x + underlay.width)
    maxY = Math.max(maxY, underlay.y + underlay.height)
  }

  const shiftX = -minX
  const shiftY = -minY

  return {
    width: maxX - minX,
    height: maxY - minY,
    originX: hex.originX + shiftX,
    originY: hex.originY + shiftY,
    field: {
      x: field.x + shiftX,
      y: field.y + shiftY,
      width: field.width,
      height: field.height,
    },
    underlay: underlay
      ? {
          x: underlay.x + shiftX,
          y: underlay.y + shiftY,
          width: underlay.width,
          height: underlay.height,
        }
      : null,
  }
}

function drawMapUnderlay(
  ctx: CanvasRenderingContext2D,
  images: LoadedMapImage[],
  field: Rect,
  align: MapImageAlign,
) {
  if (images.length === 0) return

  // Primary image aligned to hex field; extra tiles drawn sequentially to the right.
  // Source stays at natural pixels (no preload downscale). Fit/zoom only via draw + CSS.
  // Independent scaleX/scaleY corrects printed-grid aspect drift vs mathematical hexes.
  let cursorX = field.x + align.offsetX
  const baseY = field.y + align.offsetY

  for (let i = 0; i < images.length; i++) {
    const img = images[i]!
    const { sx, sy } = effectiveUnderlayScales(align, field.width, img.naturalWidth)
    const dw = img.naturalWidth * sx
    const dh = img.naturalHeight * sy
    // Soften only when shrinking into the hex field; keep sharp when 1:1 or upscaling.
    const shrinking = dw < img.naturalWidth - 0.5 || dh < img.naturalHeight - 0.5
    ctx.imageSmoothingEnabled = shrinking
    if (shrinking) ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img.source, 0, 0, img.naturalWidth, img.naturalHeight, cursorX, baseY, dw, dh)
    cursorX += dw
  }
}

function drawCalibMarkers(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  markers: CalibSessionMarkers,
) {
  const drawCross = (lx: number, ly: number, color: string, label: string) => {
    const x = lx + originX
    const y = ly + originY
    const arm = 10
    ctx.strokeStyle = color
    ctx.fillStyle = color
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(x - arm, y)
    ctx.lineTo(x + arm, y)
    ctx.moveTo(x, y - arm)
    ctx.lineTo(x, y + arm)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.stroke()
    ctx.font = '11px ui-monospace, monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'bottom'
    ctx.fillText(label, x + 8, y - 6)
  }

  if (markers.map1) drawCross(markers.map1.x, markers.map1.y, '#ffb454', 'A печать')
  if (markers.map2) drawCross(markers.map2.x, markers.map2.y, '#ffb454', 'B печать')
  if (markers.hex1) {
    const p = axialToPixel(markers.hex1.q, markers.hex1.r, HEX_SIZE)
    drawCross(p.x, p.y, '#7dd3fc', `A ${markers.hex1.q},${markers.hex1.r}`)
  }
  if (markers.hex2) {
    const p = axialToPixel(markers.hex2.q, markers.hex2.r, HEX_SIZE)
    drawCross(p.x, p.y, '#7dd3fc', `B ${markers.hex2.q},${markers.hex2.r}`)
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

function clampScroll(viewport: HTMLElement, left: number, top: number) {
  const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
  const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  viewport.scrollLeft = Math.min(maxLeft, Math.max(0, left))
  viewport.scrollTop = Math.min(maxTop, Math.max(0, top))
}

export function HexCanvas({
  map,
  selectedTerrain,
  hover,
  onHover,
  onPaint,
  mapImages = [],
  layerMode = 'both',
  align = { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0, fitWidth: true },
  gridOpacity = 0.45,
  viewScale: viewScaleProp,
  onViewScaleChange,
  tool = 'paint',
  viewportFit = 'contain',
  onViewportFitChange,
  calibPhase = null,
  calibMarkers,
  onCalibMapClick,
  onCalibHexClick,
}: HexCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)
  const paintingRef = useRef(false)
  const viewScaleRef = useRef(1)
  const spaceHeldRef = useRef(false)
  const viewportFitRef = useRef(viewportFit)
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
  /** Static scene (underlay + grid) — hover is composited on top to avoid full redraw. */
  const sceneCacheRef = useRef<HTMLCanvasElement | null>(null)
  const viewScale = viewScaleProp ?? internalViewScale
  const layout = computeSceneLayout(map, mapImages, align)
  const showMap = layerMode === 'map' || layerMode === 'both'
  const showGrid = layerMode === 'grid' || layerMode === 'both'
  const wantPanCursor = tool === 'pan' || spaceHeld || panning
  /** Prefer the map sheet rect for framing; fall back to full scene. */
  const fitTarget: Rect = layout.underlay ?? {
    x: 0,
    y: 0,
    width: layout.width,
    height: layout.height,
  }

  useEffect(() => {
    viewScaleRef.current = viewScale
  }, [viewScale])

  useEffect(() => {
    viewportFitRef.current = viewportFit
  }, [viewportFit])

  function setViewScale(next: number) {
    const clamped = clampViewScale(next)
    viewScaleRef.current = clamped
    if (viewScaleProp === undefined) setInternalViewScale(clamped)
    onViewScaleChange?.(clamped)
  }

  function markFreeFit() {
    if (viewportFitRef.current === 'free') return
    viewportFitRef.current = 'free'
    onViewportFitChange?.('free')
  }

  /** Scroll so `target` is centered in the viewport at the current scale. */
  function centerTargetInViewport(target: Rect, scale: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    const scaledW = target.width * scale
    const scaledH = target.height * scale
    const left = target.x * scale - (viewport.clientWidth - scaledW) / 2
    const top = target.y * scale - (viewport.clientHeight - scaledH) / 2
    clampScroll(viewport, left, top)
  }

  /** Fit entire map sheet into the viewport (contain / letterbox). */
  function fitContain() {
    const viewport = viewportRef.current
    if (!viewport || fitTarget.width <= 0 || fitTarget.height <= 0) return
    const next = clampViewScale(
      Math.min(viewport.clientWidth / fitTarget.width, viewport.clientHeight / fitTarget.height),
    )
    setViewScale(next)
    requestAnimationFrame(() => centerTargetInViewport(fitTarget, next))
  }

  /** Fit map sheet width to the viewport (height may require scroll). */
  function fitWidth() {
    const viewport = viewportRef.current
    if (!viewport || fitTarget.width <= 0) return
    const next = clampViewScale(viewport.clientWidth / fitTarget.width)
    setViewScale(next)
    requestAnimationFrame(() => {
      const viewportNow = viewportRef.current
      if (!viewportNow) return
      // Keep horizontal framing on the sheet; vertical: show top of sheet.
      const left = fitTarget.x * next - (viewportNow.clientWidth - fitTarget.width * next) / 2
      const top = fitTarget.y * next
      clampScroll(viewportNow, left, top)
    })
  }

  function applyViewportFit(mode: ViewportFitMode) {
    if (mode === 'contain') fitContain()
    else if (mode === 'width') fitWidth()
  }

  // Auto-fit contain/width on resize, map size, underlay load, or mode change.
  useEffect(() => {
    if (viewportFit === 'free') return
    const viewport = viewportRef.current
    if (!viewport) return

    applyViewportFit(viewportFit)

    const ro = new ResizeObserver(() => {
      if (viewportFitRef.current === 'free') return
      applyViewportFit(viewportFitRef.current)
    })
    ro.observe(viewport)
    return () => ro.disconnect()
    // layout + images gate re-fit; apply reads live viewport / fitTarget.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [
    viewportFit,
    layout.width,
    layout.height,
    fitTarget.width,
    fitTarget.height,
    fitTarget.x,
    fitTarget.y,
    map.width,
    map.height,
    mapImages,
    align.scaleX,
    align.scaleY,
    align.offsetX,
    align.offsetY,
    align.fitWidth,
  ])

  // Rebuild static scene cache when map / underlay / layers change (not on hover).
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1
    const w = Math.floor(layout.width * dpr)
    const h = Math.floor(layout.height * dpr)
    let cache = sceneCacheRef.current
    if (!cache || cache.width !== w || cache.height !== h) {
      cache = document.createElement('canvas')
      cache.width = w
      cache.height = h
      sceneCacheRef.current = cache
    }
    const ctx = cache.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#1a1f24'
    ctx.fillRect(0, 0, layout.width, layout.height)

    if (showMap && mapImages.length > 0) {
      drawMapUnderlay(ctx, mapImages, layout.field, align)
    }

    if (showGrid) {
      const fillAlpha = showMap && mapImages.length > 0 ? gridOpacity : 1
      paintHexGrid(ctx, map, layout.originX, layout.originY, fillAlpha, showMap && mapImages.length > 0)
    }
  }, [map, layout, mapImages, layerMode, align, gridOpacity, showMap, showGrid])

  // Composite cache + hover outline onto the visible canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    const cache = sceneCacheRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = Math.floor(layout.width * dpr)
    const h = Math.floor(layout.height * dpr)
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    canvas.style.width = `${layout.width}px`
    canvas.style.height = `${layout.height}px`

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (cache) {
      ctx.drawImage(cache, 0, 0)
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (calibMarkers && calibPhase) {
      drawCalibMarkers(ctx, layout.originX, layout.originY, calibMarkers)
    }
    if (hover && !calibPhase) {
      drawHoverOutline(ctx, map, hover, layout.originX, layout.originY)
    }
  }, [
    map,
    hover,
    layout,
    mapImages,
    layerMode,
    align,
    gridOpacity,
    showMap,
    showGrid,
    calibMarkers,
    calibPhase,
  ])

  /** Zoom whole scene (underlay + grid) keeping the point under the cursor fixed. */
  function zoomTo(clientX: number, clientY: number, nextScale: number) {
    const viewport = viewportRef.current
    const spacer = spacerRef.current
    const oldScale = viewScaleRef.current
    const clamped = clampViewScale(nextScale)
    if (!spacer || !viewport || Math.abs(clamped - oldScale) < 1e-6) return

    markFreeFit()

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
      clampScroll(viewport, newLeft, newTop)
    })
  }

  function panBy(dx: number, dy: number) {
    const viewport = viewportRef.current
    if (!viewport) return
    // Native scroll already clamps to spacer bounds (= full scene including underlay).
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

  /** Canvas-local point (relative to hex origin), accounting for CSS view zoom. */
  function eventToLocal(e: { clientX: number; clientY: number }): CalibMapClick | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: ((e.clientX - rect.left) / rect.width) * layout.width - layout.originX,
      y: ((e.clientY - rect.top) / rect.height) * layout.height - layout.originY,
    }
  }

  function eventToHex(e: { clientX: number; clientY: number }): { q: number; r: number } | null {
    const local = eventToLocal(e)
    if (!local) return null
    const hex = pixelToAxial(local.x, local.y, HEX_SIZE)
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
    if (e.button !== 0) return

    // 2-point calibration: map clicks (any spot) then overlay hex picks.
    if (calibPhase === 'map1' || calibPhase === 'map2') {
      const local = eventToLocal(e)
      if (local) onCalibMapClick?.(local)
      return
    }
    if (calibPhase === 'hex1' || calibPhase === 'hex2') {
      const hex = eventToHex(e)
      if (hex) onCalibHexClick?.(hex)
      return
    }

    if (tool !== 'paint') return
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
    if (calibPhase || tool !== 'paint' || spaceHeldRef.current) {
      onHover(calibPhase && (calibPhase === 'hex1' || calibPhase === 'hex2') ? eventToHex(e) : null)
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

  const cursor = panning
    ? 'grabbing'
    : wantPanCursor
      ? 'grab'
      : calibPhase
        ? 'crosshair'
        : 'crosshair'

  const calibTitle =
    calibPhase === 'map1'
      ? 'Калибровка: кликните центр печатного гекса A (далеко слева/снизу)'
      : calibPhase === 'map2'
        ? 'Калибровка: кликните центр печатного гекса B (далеко справа/сверху)'
        : calibPhase === 'hex1'
          ? 'Калибровка: кликните соответствующий гекс оверлея A'
          : calibPhase === 'hex2'
            ? 'Калибровка: кликните соответствующий гекс оверлея B'
            : null

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
            calibTitle ??
            (tool === 'pan' || spaceHeld
              ? 'Рука: перетащите карту'
              : `Кисть: ${selectedTerrain} · Space/СКМ — pan · щипок — зум`)
          }
        />
      </div>
    </div>
  )
}

export { MIN_VIEW_SCALE, MAX_VIEW_SCALE }
