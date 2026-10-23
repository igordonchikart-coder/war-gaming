import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTO_CALIB_ERROR_NOTE,
  AUTO_CALIB_GRID_HEIGHT,
  AUTO_CALIB_GRID_WIDTH,
  AUTO_CALIBRATION,
  loadShippedCalibration,
} from '../hex/autoCalibrate'
import {
  bakeFitWidthOff,
  hexFieldPixelWidth,
  solveTwoPointAlign,
  type CalibHex,
  type CalibPoint,
} from '../hex/calibrate'
import {
  clampSize,
  createEmptyMap,
  getTerrain,
  parseMap,
  parseMapAlign,
  resizeMap,
  serializeMap,
  setTerrain,
  suggestGridSizeForUnderlay,
} from '../hex/map'
import {
  DEFAULT_MAP_IMAGE_URL,
  UNDERLAY_PRESETS,
  loadMapImage,
  loadMapImagesProgressive,
  type LoadedMapImage,
  type MapImageAlign,
  type MapLayerMode,
} from '../hex/mapImage'
import {
  ALIGN_STORAGE_KEY,
  DEFAULT_MAP_WIDTH,
  LABEL_CELL_LIMIT,
  LEGACY_STORAGE_KEYS,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  STORAGE_KEY,
  TERRAIN_COLORS,
  TERRAIN_LABELS,
  WARN_MAP_SIZE,
  type MapAlignPersist,
  type MapData,
  type Terrain,
  type ViewportFitMode,
} from '../hex/types'
import {
  HexCanvas,
  MAX_VIEW_SCALE,
  MIN_VIEW_SCALE,
  type CalibPhase,
  type CalibSessionMarkers,
  type CanvasTool,
} from './HexCanvas'
import { NavMenu, useNavMenu } from './NavMenu'
import { PrecisionField } from './PrecisionField'

const TERRAIN_SHORT: Record<Terrain, string> = {
  plain: 'Р',
  forest: 'Л',
  water: 'В',
}

const LAYER_SUMMARY: Record<MapLayerMode, string> = {
  both: 'Оба',
  map: 'Карта',
  grid: 'Сетка',
}

/** Drawn cells = width × height = tiles.length (odd-q rectangular grid). */
function formatGridSize(map: MapData): string {
  return `${map.width}×${map.height} (${map.tiles.length} гексов)`
}

const TERRAINS: Terrain[] = ['plain', 'forest', 'water']

const LAYER_OPTIONS: { id: MapLayerMode; label: string }[] = [
  { id: 'both', label: 'Оба' },
  { id: 'map', label: 'Карта' },
  { id: 'grid', label: 'Сетка' },
]

function clampViewZoom(n: number): number {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, n))
}

function buildMapAlign(
  align: MapImageAlign,
  viewZoom: number,
  layerMode: MapLayerMode,
  gridOpacity: number,
  viewportFit: ViewportFitMode,
): MapAlignPersist {
  return {
    scaleX: align.scaleX,
    scaleY: align.scaleY,
    offsetX: align.offsetX,
    offsetY: align.offsetY,
    shearX: align.shearX ?? 0,
    shearY: align.shearY ?? 0,
    ...(align.perspective ? { perspective: align.perspective } : {}),
    ...(align.perspectiveInv ? { perspectiveInv: align.perspectiveInv } : {}),
    ...(align.warpMesh ? { warpMesh: align.warpMesh } : {}),
    fitWidth: align.fitWidth,
    viewZoom,
    viewportFit,
    layerMode,
    gridOpacity,
  }
}

function alignFromPersist(persist: MapAlignPersist): MapImageAlign {
  return {
    scaleX: persist.scaleX,
    scaleY: persist.scaleY,
    offsetX: persist.offsetX,
    offsetY: persist.offsetY,
    shearX: persist.shearX ?? 0,
    shearY: persist.shearY ?? 0,
    ...(persist.perspective ? { perspective: persist.perspective } : {}),
    ...(persist.perspectiveInv ? { perspectiveInv: persist.perspectiveInv } : {}),
    ...(persist.warpMesh ? { warpMesh: persist.warpMesh } : {}),
    fitWidth: persist.fitWidth,
  }
}

/** Drop stale v1 keys that still hold fitWidth Scale≈0.96 and override new defaults. */
function clearLegacyAlignStorage() {
  try {
    for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key)
  } catch {
    // ignore quota / private mode
  }
}

function mapWithAlign(
  map: MapData,
  align: MapImageAlign,
  viewZoom: number,
  layerMode: MapLayerMode,
  gridOpacity: number,
  viewportFit: ViewportFitMode,
): MapData {
  return {
    ...map,
    mapAlign: buildMapAlign(align, viewZoom, layerMode, gridOpacity, viewportFit),
  }
}

/** Minimal File System Access API surface (Chrome/Edge); not in all TS DOM libs. */
type SaveFilePickerHandle = {
  name: string
  createWritable: () => Promise<{
    write: (data: Blob | string) => Promise<void>
    close: () => Promise<void>
  }>
}

type ShowSaveFilePickerFn = (options?: {
  suggestedName?: string
  types?: Array<{ description?: string; accept: Record<string, string[]> }>
}) => Promise<SaveFilePickerHandle>

function getShowSaveFilePicker(): ShowSaveFilePickerFn | undefined {
  const w = window as Window & { showSaveFilePicker?: ShowSaveFilePickerFn }
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(w) : undefined
}

/** Full path when host exposes it (e.g. Electron); browsers usually only give the name. */
function resolveSavedPath(handle: SaveFilePickerHandle): string | undefined {
  const withPath = handle as SaveFilePickerHandle & { path?: unknown }
  return typeof withPath.path === 'string' && withPath.path.length > 0 ? withPath.path : undefined
}

function applyMapAlignToState(
  persist: MapAlignPersist | undefined,
  setters: {
    setAlign: (a: MapImageAlign) => void
    setViewScale: (n: number) => void
    setLayerMode: (m: MapLayerMode) => void
    setGridOpacity: (n: number) => void
    setViewportFit: (m: ViewportFitMode) => void
  },
) {
  if (!persist) return
  setters.setAlign(alignFromPersist(persist))
  // Default to contain so old saves still show the full sheet on load.
  setters.setViewportFit(persist.viewportFit ?? 'contain')
  if (persist.viewportFit === 'free' && persist.viewZoom !== undefined) {
    setters.setViewScale(clampViewZoom(persist.viewZoom))
  }
  if (persist.layerMode) setters.setLayerMode(persist.layerMode)
  if (persist.gridOpacity !== undefined) setters.setGridOpacity(persist.gridOpacity)
}

function loadAlignFromStorage(): MapAlignPersist | undefined {
  try {
    const raw = localStorage.getItem(ALIGN_STORAGE_KEY)
    if (!raw) return undefined
    return parseMapAlign(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export function MapEditor() {
  const initial = loadInitialDocument()
  const [map, setMap] = useState<MapData>(() => initial.map)
  const [brush, setBrush] = useState<Terrain>('plain')
  const [hover, setHover] = useState<{ q: number; r: number } | null>(null)
  const [widthInput, setWidthInput] = useState(String(initial.map.width))
  const [heightInput, setHeightInput] = useState(String(initial.map.height))
  const [status, setStatus] = useState('Готово')
  const [layerMode, setLayerMode] = useState<MapLayerMode>(initial.layerMode)
  const [align, setAlign] = useState<MapImageAlign>(initial.align)
  const [gridOpacity, setGridOpacity] = useState(initial.gridOpacity)
  const [mapImages, setMapImages] = useState<LoadedMapImage[]>([])
  const [viewScale, setViewScale] = useState(initial.viewZoom)
  const [viewportFit, setViewportFit] = useState<ViewportFitMode>(initial.viewportFit)
  const [tool, setTool] = useState<CanvasTool>('paint')
  /** Optional GPU-friendly downscale; default is full master quality. */
  const [fastUnderlay, setFastUnderlay] = useState(false)
  /** Active underlay URL (preset or blob: from «Загрузить подложку…»). */
  const [underlayUrl, setUnderlayUrl] = useState(DEFAULT_MAP_IMAGE_URL)
  const [underlayLabel, setUnderlayLabel] = useState(
    () => UNDERLAY_PRESETS.find((p) => p.url === DEFAULT_MAP_IMAGE_URL)?.label ?? 'Подложка',
  )
  const [calibPhase, setCalibPhase] = useState<CalibPhase | null>(null)
  const [calibMap1, setCalibMap1] = useState<CalibPoint | null>(null)
  const [calibMap2, setCalibMap2] = useState<CalibPoint | null>(null)
  const [calibHex1, setCalibHex1] = useState<CalibHex | null>(null)
  const [calibHex2, setCalibHex2] = useState<CalibHex | null>(null)
  /** Double-click terrain picker anchored near the cursor. */
  const [terrainPicker, setTerrainPicker] = useState<{
    q: number
    r: number
    x: number
    y: number
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const underlayInputRef = useRef<HTMLInputElement>(null)
  const underlayObjectUrlRef = useRef<string | null>(null)
  const terrainPickerRef = useRef<HTMLDivElement>(null)
  const skipAutosaveRef = useRef(true)
  const { openId, setOpenId } = useNavMenu()
  const mapImagesRef = useRef(mapImages)
  mapImagesRef.current = mapImages
  const mapRef = useRef(map)
  mapRef.current = map
  const alignRef = useRef(align)
  alignRef.current = align

  useEffect(() => {
    setWidthInput(String(map.width))
    setHeightInput(String(map.height))
  }, [map.width, map.height])

  useEffect(() => {
    let cancelled = false
    setStatus(
      fastUnderlay
        ? `Загрузка подложки (быстрая)… ${underlayLabel}`
        : `Загрузка подложки (FULL)… ${underlayLabel}`,
    )
    const loader = underlayUrl.startsWith('blob:')
      ? loadMapImage(underlayUrl, { fast: fastUnderlay }).then((img) => [img])
      : loadMapImagesProgressive(
          underlayUrl,
          undefined,
          (loaded, index, total) => {
            if (cancelled) return
            const quality = loaded.downscaled ? 'даунскейл' : 'FULL'
            setStatus(
              `Подложка ${index + 1}/${total} · ${quality} · ${loaded.url} · ${loaded.naturalWidth}×${loaded.naturalHeight} px`,
            )
          },
          { fast: fastUnderlay },
        )
    loader
      .then((images) => {
        if (cancelled) return
        setMapImages(images)
        if (!images.length) {
          setStatus('Подложка не найдена (см. public/map/README.md)')
          return
        }
        const primary = images[0]!
        const quality = primary.downscaled ? 'даунскейл' : 'FULL'
        setStatus(
          `Подложка ${quality} · ${underlayLabel} · ${primary.naturalWidth}×${primary.naturalHeight} px` +
            (images.length > 1 ? ` (+${images.length - 1} тайлов)` : ''),
        )
      })
      .catch((err) => {
        if (cancelled) return
        setMapImages([])
        setStatus(err instanceof Error ? err.message : 'Ошибка загрузки карты')
      })
    return () => {
      cancelled = true
    }
  }, [fastUnderlay, underlayUrl, underlayLabel])

  useEffect(() => {
    return () => {
      if (underlayObjectUrlRef.current) {
        URL.revokeObjectURL(underlayObjectUrlRef.current)
        underlayObjectUrlRef.current = null
      }
    }
  }, [])

  // Autosave map + calibration to localStorage (skip first paint).
  useEffect(() => {
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
      try {
        localStorage.setItem(STORAGE_KEY, serializeMap(doc))
        localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(doc.mapAlign))
      } catch {
        // quota / private mode — ignore
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [map, align, viewScale, layerMode, gridOpacity, viewportFit])

  /** Dismissing the picker via a canvas click should not also paint that hex. */
  const suppressNextPaintRef = useRef(false)
  /**
   * First click of a double-click still hits the brush; remember prior terrain
   * briefly so opening the picker can restore it (Esc then leaves the hex unchanged).
   */
  const recentPaintUndoRef = useRef<{
    q: number
    r: number
    prev: Terrain
    at: number
  } | null>(null)

  const paint = useCallback(
    (q: number, r: number) => {
      if (suppressNextPaintRef.current) {
        suppressNextPaintRef.current = false
        return
      }
      setMap((prev) => {
        const before = getTerrain(prev, q, r)
        if (before != null && before !== brush) {
          recentPaintUndoRef.current = { q, r, prev: before, at: performance.now() }
        }
        return setTerrain(prev, q, r, brush)
      })
    },
    [brush],
  )

  const closeTerrainPicker = useCallback(() => {
    setTerrainPicker(null)
  }, [])

  const openTerrainPicker = useCallback(
    (hex: { q: number; r: number }, clientX: number, clientY: number) => {
      setOpenId(null)
      // Undo brush paint from the first click of this double-click (if any).
      const undo = recentPaintUndoRef.current
      if (
        undo &&
        undo.q === hex.q &&
        undo.r === hex.r &&
        performance.now() - undo.at < 500
      ) {
        setMap((prev) => setTerrain(prev, undo.q, undo.r, undo.prev))
        recentPaintUndoRef.current = null
      }
      // Nudge slightly so the menu sits under the cursor without covering the hex center.
      const pad = 8
      const approxW = 148
      const approxH = 16 + TERRAINS.length * 34
      const x = Math.min(Math.max(pad, clientX + 6), window.innerWidth - approxW - pad)
      const y = Math.min(Math.max(pad, clientY + 6), window.innerHeight - approxH - pad)
      setTerrainPicker({ q: hex.q, r: hex.r, x, y })
    },
    [setOpenId],
  )

  const applyTerrainFromPicker = useCallback(
    (terrain: Terrain) => {
      if (!terrainPicker) return
      const { q, r } = terrainPicker
      setMap((prev) => setTerrain(prev, q, r, terrain))
      setBrush(terrain)
      setTool('paint')
      setTerrainPicker(null)
      setStatus(`Гекс ${q},${r} → ${TERRAIN_LABELS[terrain]}`)
    },
    [terrainPicker],
  )

  // Esc / click outside closes the hex terrain picker without applying.
  useEffect(() => {
    if (!terrainPicker) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeTerrainPicker()
      }
    }

    function onPointer(e: MouseEvent | PointerEvent) {
      const el = terrainPickerRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        if (e.target instanceof Element && e.target.closest('.hex-canvas')) {
          suppressNextPaintRef.current = true
        }
        closeTerrainPicker()
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [terrainPicker, closeTerrainPicker])

  function sizeWarning(w: number, h: number): string {
    if (w > WARN_MAP_SIZE || h > WARN_MAP_SIZE) {
      return ` · внимание: сторона >${WARN_MAP_SIZE} (потолок ${MAX_MAP_SIZE})`
    }
    if (w * h > LABEL_CELL_LIMIT) {
      return ` · подписи q,r скрыты (>${LABEL_CELL_LIMIT} гексов)`
    }
    return ''
  }

  function applySize() {
    const rawW = Number(widthInput)
    const rawH = Number(heightInput)
    if (!Number.isFinite(rawW) || !Number.isFinite(rawH)) {
      setStatus('Размер должен быть числом')
      return
    }
    const w = clampSize(rawW)
    const h = clampSize(rawH)
    setWidthInput(String(w))
    setHeightInput(String(h))
    setMap((prev) => resizeMap(prev, w, h))
    setStatus(`Сетка: ${w}×${h} (${w * h} гексов)${sizeWarning(w, h)}`)
  }

  function nudgeSize(axis: 'w' | 'h', dir: -1 | 1) {
    const raw = axis === 'w' ? Number(widthInput) : Number(heightInput)
    const base = Number.isFinite(raw) ? raw : axis === 'w' ? map.width : map.height
    const next = clampSize(base + dir)
    if (axis === 'w') setWidthInput(String(next))
    else setHeightInput(String(next))
  }

  function closeMenu() {
    setOpenId(null)
  }

  function runAndClose(fn: () => void) {
    fn()
    closeMenu()
  }

  /** Resize grid so field aspect matches the loaded underlay (covers sheet at fit-width). */
  function applySizeFromUnderlay() {
    const primary = mapImages[0]
    if (!primary) {
      setStatus('Нет подложки — сначала дождитесь загрузки map.webp')
      return
    }
    const suggested = suggestGridSizeForUnderlay(
      primary.naturalWidth,
      primary.naturalHeight,
      Number(widthInput) || DEFAULT_MAP_WIDTH,
    )
    const w = suggested.width
    const h = suggested.height
    setWidthInput(String(w))
    setHeightInput(String(h))
    setMap((prev) => resizeMap(prev, w, h))
    setStatus(
      `Сетка по подложке ${primary.naturalWidth}×${primary.naturalHeight}: ${w}×${h} (${w * h} гексов)${sizeWarning(w, h)}`,
    )
  }

  function handleNew() {
    const next = createEmptyMap(map.width, map.height)
    setMap(next)
    setStatus('Новая карта')
  }

  async function handleSaveAs() {
    const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
    const json = serializeMap(doc)
    const suggestedName = 'war-gaming-map.json'
    const picker = getShowSaveFilePicker()

    if (picker) {
      try {
        const handle = await picker({
          suggestedName,
          types: [
            {
              description: 'Карта War Gaming (JSON)',
              accept: { 'application/json': ['.json'] },
            },
          ],
        })
        const writable = await handle.createWritable()
        await writable.write(json)
        await writable.close()
        const where = resolveSavedPath(handle) ?? handle.name
        setStatus(`Сохранено (карта + калибровка): ${where}`)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setStatus('Сохранение отменено')
          return
        }
        setStatus(err instanceof Error ? err.message : 'Ошибка сохранения')
      }
      return
    }

    const typed = window.prompt('Имя файла', suggestedName)?.trim()
    if (!typed) {
      setStatus('Сохранение отменено')
      return
    }
    const filename = /\.json$/i.test(typed) ? typed : `${typed}.json`
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    setStatus(`Сохранено (карта + калибровка): ${filename}`)
  }

  function handleSaveLocal() {
    const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
    localStorage.setItem(STORAGE_KEY, serializeMap(doc))
    localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(doc.mapAlign))
    setStatus('В браузере (localStorage): карта + калибровка')
  }

  function handleSaveCalibration() {
    const persist = buildMapAlign(align, viewScale, layerMode, gridOpacity, viewportFit)
    localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(persist))
    const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
    localStorage.setItem(STORAGE_KEY, serializeMap(doc))
    setStatus('Калибровка сохранена (JSON / localStorage)')
  }

  function handleLoadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      setStatus('В localStorage нет карты')
      return
    }
    try {
      const parsed = parseMap(raw)
      setMap(parsed)
      applyMapAlignToState(parsed.mapAlign ?? loadAlignFromStorage(), {
        setAlign,
        setViewScale,
        setLayerMode,
        setGridOpacity,
        setViewportFit,
      })
      setStatus('Загружено из localStorage (карта + калибровка)')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка загрузки')
    }
  }

  function handleLoadFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        const parsed = parseMap(text)
        setMap(parsed)
        applyMapAlignToState(parsed.mapAlign, {
          setAlign,
          setViewScale,
          setLayerMode,
          setGridOpacity,
          setViewportFit,
        })
        setStatus(`Загружено: ${file.name}`)
      } catch (err) {
        setStatus(err instanceof Error ? err.message : 'Ошибка файла')
      }
    }
    reader.onerror = () => setStatus('Не удалось прочитать файл')
    reader.readAsText(file)
  }

  function selectUnderlayPreset(url: string, label: string) {
    if (underlayObjectUrlRef.current) {
      URL.revokeObjectURL(underlayObjectUrlRef.current)
      underlayObjectUrlRef.current = null
    }
    setUnderlayLabel(label)
    setUnderlayUrl(url)
    setStatus(`Подложка: ${label}`)
  }

  function handleLoadUnderlayFile(file: File) {
    if (!file.type.startsWith('image/') && !/\.(png|webp|jpe?g)$/i.test(file.name)) {
      setStatus('Нужен PNG / WebP / JPEG')
      return
    }
    if (underlayObjectUrlRef.current) {
      URL.revokeObjectURL(underlayObjectUrlRef.current)
    }
    const url = URL.createObjectURL(file)
    underlayObjectUrlRef.current = url
    setUnderlayLabel(file.name)
    setUnderlayUrl(url)
    setStatus(`Загрузка подложки: ${file.name}…`)
  }

  function fieldWidthForAlign(): number {
    return hexFieldPixelWidth(mapRef.current.width)
  }

  function primaryImageWidth(): number {
    return mapImagesRef.current[0]?.naturalWidth ?? 0
  }

  /**
   * Patch align. Manual scaleX/Y bakes fitWidth off so Fit is only a starting point.
   * Passing fitWidth explicitly (checkbox / reset / calib) is left as-is.
   */
  function updateAlign(partial: Partial<MapImageAlign>) {
    setAlign((prev) => {
      let base = prev
      const touchingScale =
        (partial.scaleX !== undefined && partial.scaleX !== prev.scaleX) ||
        (partial.scaleY !== undefined && partial.scaleY !== prev.scaleY)
      if (touchingScale && partial.fitWidth === undefined && prev.fitWidth) {
        const imgW = primaryImageWidth()
        if (imgW > 0) {
          base = bakeFitWidthOff(prev, fieldWidthForAlign(), imgW)
        } else {
          base = { ...prev, fitWidth: false }
        }
      }
      return { ...base, ...partial }
    })
  }

  function resetCalibrationSession() {
    setCalibPhase(null)
    setCalibMap1(null)
    setCalibMap2(null)
    setCalibHex1(null)
    setCalibHex2(null)
  }

  /** One-click: apply shipped auto-calibration (+ optional resize to printed extent). */
  async function handleAutoCalibrate() {
    resetCalibrationSession()
    setStatus('Автокалибровка…')
    const { align: next, fromFile } = await loadShippedCalibration()
    clearLegacyAlignStorage()
    setAlign(next)
    setMap((prev) => {
      if (prev.width === AUTO_CALIB_GRID_WIDTH && prev.height === AUTO_CALIB_GRID_HEIGHT) {
        return prev
      }
      return resizeMap(prev, AUTO_CALIB_GRID_WIDTH, AUTO_CALIB_GRID_HEIGHT)
    })
    setWidthInput(String(AUTO_CALIB_GRID_WIDTH))
    setHeightInput(String(AUTO_CALIB_GRID_HEIGHT))
    setViewportFit('contain')
    // Force-write new absolute calib so stale LS (Scale≈0.96) cannot stick.
    const persist = buildMapAlign(next, viewScale, layerMode, gridOpacity, 'contain')
    try {
      localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(persist))
    } catch {
      // ignore
    }
    const src = fromFile ? '/map/calibration.json' : 'встроенная'
    setStatus(
      `Автокалибровка применена (${src}) · X ${next.scaleX.toFixed(4)} · Y ${next.scaleY.toFixed(4)} · ` +
        `сетка ${AUTO_CALIB_GRID_WIDTH}×${AUTO_CALIB_GRID_HEIGHT} · ${AUTO_CALIB_ERROR_NOTE}`,
    )
  }

  function startTwoPointCalib() {
    setCalibMap1(null)
    setCalibMap2(null)
    setCalibHex1(null)
    setCalibHex2(null)
    setCalibPhase('map1')
    setTool('paint')
    setStatus(
      'Калибровка 2 точки: кликните центр печатного гекса A (угол листа, далеко слева)',
    )
  }

  function cancelTwoPointCalib() {
    resetCalibrationSession()
    setStatus('Калибровка отменена')
  }

  function finishTwoPointCalib(
    map1: CalibPoint,
    map2: CalibPoint,
    hex1: CalibHex,
    hex2: CalibHex,
  ) {
    const imgW = primaryImageWidth()
    if (!(imgW > 0)) {
      setStatus('Нет подложки — калибровка невозможна')
      resetCalibrationSession()
      return
    }
    const result = solveTwoPointAlign({
      mapClick1: map1,
      mapClick2: map2,
      hex1,
      hex2,
      currentAlign: alignRef.current,
      fieldWidth: fieldWidthForAlign(),
      imageNaturalWidth: imgW,
    })
    if ('error' in result) {
      setStatus(`Калибровка: ${result.error}`)
      resetCalibrationSession()
      return
    }
    setAlign(result)
    resetCalibrationSession()
    setStatus(
      `Калибровка OK · Scale X ${result.scaleX.toFixed(4)} · Y ${result.scaleY.toFixed(4)} · Fit выкл`,
    )
  }

  function handleCalibMapClick(point: CalibPoint) {
    if (calibPhase === 'map1') {
      setCalibMap1(point)
      setCalibPhase('map2')
      setStatus('Калибровка: кликните центр печатного гекса B (далеко по диагонали)')
      return
    }
    if (calibPhase === 'map2') {
      setCalibMap2(point)
      setCalibPhase('hex1')
      setStatus('Калибровка: кликните гекс оверлея, соответствующий точке A')
    }
  }

  function handleCalibHexClick(hex: CalibHex) {
    if (calibPhase === 'hex1') {
      setCalibHex1(hex)
      setCalibPhase('hex2')
      setStatus(`A = ${hex.q},${hex.r} · кликните гекс оверлея для точки B`)
      return
    }
    if (calibPhase === 'hex2') {
      if (!calibMap1 || !calibMap2 || !calibHex1) {
        setStatus('Калибровка: не хватает точек — начните снова')
        resetCalibrationSession()
        return
      }
      finishTwoPointCalib(calibMap1, calibMap2, calibHex1, hex)
    }
  }

  function handleViewScaleChange(next: number) {
    setViewportFit('free')
    setViewScale(next)
  }

  const calibMarkers: CalibSessionMarkers | undefined = calibPhase
    ? { map1: calibMap1, map2: calibMap2, hex1: calibHex1, hex2: calibHex2 }
    : undefined

  const toolSummary = tool === 'paint' ? 'Кисть' : 'Рука'
  const frameSummary =
    viewportFit === 'free'
      ? `${(viewScale * 100).toFixed(0)}%`
      : viewportFit === 'contain'
        ? 'вся'
        : 'ширина'
  const sizeSummary = `${map.width}×${map.height}`

  return (
    <div className="editor">
      <nav className="editor__nav" aria-label="Панель редактора">
        <span className="editor__brand">War Gaming</span>

        <NavMenu
          id="tool"
          openId={openId}
          onOpenChange={setOpenId}
          label="Инструмент"
          summary={toolSummary}
        >
          <div className="nav-menu__row">
            <button
              type="button"
              className={`nav-btn${tool === 'paint' ? ' is-active' : ''}`}
              onClick={() => {
                setTool('paint')
                closeMenu()
              }}
              title="ЛКМ — рисовать тайл"
            >
              Кисть
            </button>
            <button
              type="button"
              className={`nav-btn${tool === 'pan' ? ' is-active' : ''}`}
              onClick={() => {
                setTool('pan')
                closeMenu()
              }}
              title="ЛКМ — двигать карту (также Space+drag / СКМ)"
            >
              Рука
            </button>
          </div>
        </NavMenu>

        <NavMenu
          id="layers"
          openId={openId}
          onOpenChange={setOpenId}
          label="Слои"
          summary={LAYER_SUMMARY[layerMode]}
        >
          <div className="nav-menu__row">
            {LAYER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`nav-btn${layerMode === opt.id ? ' is-active' : ''}`}
                onClick={() => {
                  setLayerMode(opt.id)
                  closeMenu()
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <label
            className="align-controls__check"
            title="По умолчанию FULL без даунскейла. Включите только если тормозит (Map2 большой)."
          >
            <input
              type="checkbox"
              checked={fastUnderlay}
              onChange={(e) => setFastUnderlay(e.target.checked)}
            />
            Быстрая подложка
          </label>
        </NavMenu>

        <NavMenu
          id="underlay"
          openId={openId}
          onOpenChange={setOpenId}
          label="Подложка"
          summary={underlayLabel.length > 18 ? `${underlayLabel.slice(0, 16)}…` : underlayLabel}
        >
          <div className="file-controls">
            {UNDERLAY_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={underlayUrl === p.url ? 'file-controls__primary' : undefined}
                onClick={() => {
                  selectUnderlayPreset(p.url, p.label)
                  closeMenu()
                }}
                title={p.url}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              className="file-controls__primary"
              onClick={() => {
                closeMenu()
                underlayInputRef.current?.click()
              }}
              title="Открыть PNG/WebP/JPEG с диска"
            >
              Загрузить подложку…
            </button>
          </div>
          <p className="nav-menu__hint" role="note">
            Активна: {underlayLabel}. Map2 — PNG flat-top 23×11. После смены — «Автокалибровка».
          </p>
        </NavMenu>

        <NavMenu
          id="frame"
          openId={openId}
          onOpenChange={setOpenId}
          label="Кадр"
          summary={frameSummary}
        >
          <div className="nav-menu__row">
            <button
              type="button"
              className={`nav-btn${viewportFit === 'contain' ? ' is-active' : ''}`}
              onClick={() => {
                setViewportFit('contain')
                closeMenu()
              }}
              title="Показать весь лист map.webp в области холста (contain, с letterbox)"
            >
              Вся карта
            </button>
            <button
              type="button"
              className={`nav-btn${viewportFit === 'width' ? ' is-active' : ''}`}
              onClick={() => {
                setViewportFit('width')
                closeMenu()
              }}
              title="Подогнать ширину листа под холст (низ может требовать прокрутки)"
            >
              По ширине
            </button>
          </div>
          <PrecisionField
            label="Zoom"
            title="Зум сцены (щипок / Ctrl+колёсико). Сбрасывает авто-кадр в ручной режим"
            value={viewScale}
            min={MIN_VIEW_SCALE}
            max={MAX_VIEW_SCALE}
            step={0.01}
            decimals={2}
            onChange={handleViewScaleChange}
          />
          <p className="nav-menu__hint">
            Щипок / Zoom → ручной режим
            {viewportFit === 'free' ? ' · сейчас ручной' : ''}
          </p>
        </NavMenu>

        <NavMenu
          id="align"
          openId={openId}
          onOpenChange={setOpenId}
          label="Выравнивание"
          summary={`X${align.scaleX.toFixed(2)} Y${align.scaleY.toFixed(2)}`}
          accent={Boolean(calibPhase)}
        >
          <div className="nav-menu__panel--wide">
            <label
              className="align-controls__check"
              title="Старт: ширина подложки = ширина гекс-поля. Ручной Scale X/Y или калибровка 2 точки выключают Fit."
            >
              <input
                type="checkbox"
                checked={align.fitWidth}
                onChange={(e) => {
                  const on = e.target.checked
                  if (on) {
                    updateAlign({ fitWidth: true, scaleX: 1, scaleY: 1 })
                    return
                  }
                  const imgW = primaryImageWidth()
                  if (imgW > 0) {
                    setAlign((prev) => bakeFitWidthOff(prev, fieldWidthForAlign(), imgW))
                  } else {
                    updateAlign({ fitWidth: false })
                  }
                }}
              />
              Fit width → сетка
            </label>
            <div className="nav-menu__row">
              <PrecisionField
                label="Scale X"
                title="Горизонтальный масштаб подложки относительно сетки (не зум сцены)."
                value={align.scaleX}
                min={0.05}
                max={3}
                step={0.01}
                decimals={2}
                onChange={(scaleX) => updateAlign({ scaleX })}
              />
              <PrecisionField
                label="Scale Y"
                title="Вертикальный масштаб (растяжение)."
                value={align.scaleY}
                min={0.05}
                max={3}
                step={0.01}
                decimals={2}
                onChange={(scaleY) => updateAlign({ scaleY })}
              />
            </div>
            <div className="nav-menu__row">
              <PrecisionField
                label="Offset X"
                value={align.offsetX}
                min={-4000}
                max={4000}
                step={1}
                decimals={0}
                onChange={(offsetX) => updateAlign({ offsetX })}
              />
              <PrecisionField
                label="Offset Y"
                value={align.offsetY}
                min={-4000}
                max={4000}
                step={1}
                decimals={0}
                onChange={(offsetY) => updateAlign({ offsetY })}
              />
            </div>
            <PrecisionField
              label="Сетка α"
              value={gridOpacity}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              onChange={setGridOpacity}
              disabled={layerMode === 'map'}
            />
            <div className="nav-menu__row">
              <button
                type="button"
                className="nav-btn is-active"
                onClick={() => {
                  void handleAutoCalibrate()
                  closeMenu()
                }}
                title="Автокалибровка Map2 (scaleX/Y + offset + warp, сетка 23×11, flat-top)."
              >
                Автокалибровка
              </button>
              <button
                type="button"
                className={`nav-btn${calibPhase ? ' is-active' : ''}`}
                onClick={() => {
                  if (calibPhase) cancelTwoPointCalib()
                  else startTwoPointCalib()
                  closeMenu()
                }}
                title="Две точки на печатной сетке + два гекса оверлея"
              >
                {calibPhase ? 'Отмена привязки' : 'Калибровка 2 точки'}
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => {
                  resetCalibrationSession()
                  clearLegacyAlignStorage()
                  const next = { ...AUTO_CALIBRATION }
                  setAlign(next)
                  setGridOpacity(0.45)
                  setViewportFit('contain')
                  try {
                    localStorage.setItem(
                      ALIGN_STORAGE_KEY,
                      JSON.stringify(
                        buildMapAlign(next, viewScale, layerMode, 0.45, 'contain'),
                      ),
                    )
                  } catch {
                    // ignore
                  }
                  closeMenu()
                }}
                title="Вернуть встроенную автокалибровку"
              >
                Сброс
              </button>
              <button
                type="button"
                className="nav-btn"
                onClick={() => runAndClose(handleSaveCalibration)}
                title="Записать калибровку в localStorage и JSON карты"
              >
                Сохранить калибровку
              </button>
            </div>
            <p className="nav-menu__hint" role="note">
              Автокалибровка — плотный TPS на flat-top сетку Map2 (вся 23×11, края). Или Open →{' '}
              <code>map-align-autocal.json</code>.
            </p>
          </div>
        </NavMenu>

        <NavMenu
          id="size"
          openId={openId}
          onOpenChange={setOpenId}
          label="Размер"
          summary={sizeSummary}
        >
          <div className="size-controls">
            <label title={`Столбцы ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}`}>
              W
              <button
                type="button"
                className="size-nudge"
                disabled={Number(widthInput) <= MIN_MAP_SIZE}
                onClick={() => nudgeSize('w', -1)}
                aria-label="W: меньше"
              >
                −
              </button>
              <input
                type="number"
                min={MIN_MAP_SIZE}
                max={MAX_MAP_SIZE}
                value={widthInput}
                onChange={(e) => setWidthInput(e.target.value)}
              />
              <button
                type="button"
                className="size-nudge"
                disabled={Number(widthInput) >= MAX_MAP_SIZE}
                onClick={() => nudgeSize('w', 1)}
                aria-label="W: больше"
              >
                +
              </button>
            </label>
            <label title={`Строки ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}`}>
              H
              <button
                type="button"
                className="size-nudge"
                disabled={Number(heightInput) <= MIN_MAP_SIZE}
                onClick={() => nudgeSize('h', -1)}
                aria-label="H: меньше"
              >
                −
              </button>
              <input
                type="number"
                min={MIN_MAP_SIZE}
                max={MAX_MAP_SIZE}
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
              />
              <button
                type="button"
                className="size-nudge"
                disabled={Number(heightInput) >= MAX_MAP_SIZE}
                onClick={() => nudgeSize('h', 1)}
                aria-label="H: больше"
              >
                +
              </button>
            </label>
          </div>
          <div className="nav-menu__row">
            <button type="button" className="nav-btn" onClick={() => runAndClose(applySize)}>
              Применить
            </button>
            <button
              type="button"
              className="nav-btn"
              onClick={() => runAndClose(applySizeFromUnderlay)}
              disabled={mapImages.length === 0}
              title="Подобрать H под aspect подложки"
            >
              По подложке
            </button>
          </div>
          <p className="nav-menu__hint">
            {map.tiles.length} гексов
            {(map.width > WARN_MAP_SIZE || map.height > WARN_MAP_SIZE) && (
              <span className="size-controls__warn"> · &gt;{WARN_MAP_SIZE}</span>
            )}
            {' · '}
            {map.tiles.length > LABEL_CELL_LIMIT ? 'без подписей (LOD)' : 'подписи q,r'}
          </p>
        </NavMenu>

        <NavMenu id="file" openId={openId} onOpenChange={setOpenId} label="Файл">
          <div className="file-controls">
            <button
              type="button"
              className="file-controls__primary"
              onClick={() => {
                closeMenu()
                void handleSaveAs()
              }}
              title="Выбрать папку и имя · карта + калибровка (mapAlign)"
            >
              Сохранить как…
            </button>
            <button
              type="button"
              className="file-controls__primary"
              onClick={() => {
                closeMenu()
                underlayInputRef.current?.click()
              }}
              title="PNG/WebP/JPEG подложка с диска"
            >
              Загрузить подложку…
            </button>
            <button
              type="button"
              onClick={() => runAndClose(handleSaveLocal)}
              title="Только в этом браузере (localStorage), без файла на диске"
            >
              В браузер
            </button>
            <button type="button" onClick={() => runAndClose(handleNew)}>
              Новая
            </button>
            <button type="button" onClick={() => runAndClose(handleLoadLocal)}>
              Load LS
            </button>
            <button
              type="button"
              onClick={() => {
                closeMenu()
                fileInputRef.current?.click()
              }}
            >
              Open JSON
            </button>
          </div>
          <p className="nav-menu__hint" role="note">
            Подложка: PNG с диска или список в меню «Подложка». Сохранить как… — карта + калибровка.
          </p>
        </NavMenu>

        <div className="palette palette--inline" role="group" aria-label="Палитра тайлов">
          {TERRAINS.map((t) => (
            <button
              key={t}
              type="button"
              className={`palette__btn palette__btn--short${brush === t ? ' is-active' : ''}`}
              onClick={() => {
                setBrush(t)
                setTool('paint')
              }}
              title={TERRAIN_LABELS[t]}
              style={{ ['--swatch' as string]: TERRAIN_COLORS[t] }}
            >
              <span className="palette__swatch" aria-hidden />
              {TERRAIN_SHORT[t]}
            </button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleLoadFile(file)
            e.target.value = ''
          }}
        />
        <input
          ref={underlayInputRef}
          type="file"
          accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleLoadUnderlayFile(file)
            e.target.value = ''
          }}
        />
      </nav>

      <div className="editor__canvas-wrap">
        <HexCanvas
          map={map}
          selectedTerrain={brush}
          hover={hover}
          onHover={setHover}
          onPaint={paint}
          mapImages={mapImages}
          layerMode={layerMode}
          align={align}
          gridOpacity={gridOpacity}
          viewScale={viewScale}
          onViewScaleChange={(scale) => {
            setViewScale(scale)
          }}
          tool={tool}
          viewportFit={viewportFit}
          onViewportFitChange={setViewportFit}
          calibPhase={calibPhase}
          calibMarkers={calibMarkers}
          onCalibMapClick={handleCalibMapClick}
          onCalibHexClick={handleCalibHexClick}
          onDoubleClickHex={openTerrainPicker}
        />
      </div>

      {terrainPicker ? (
        <div
          ref={terrainPickerRef}
          className="hex-terrain-picker"
          role="menu"
          aria-label={`Тип гекса ${terrainPicker.q},${terrainPicker.r}`}
          style={{ left: terrainPicker.x, top: terrainPicker.y }}
        >
          {TERRAINS.map((t) => {
            const current = getTerrain(map, terrainPicker.q, terrainPicker.r)
            return (
              <button
                key={t}
                type="button"
                role="menuitem"
                className={`hex-terrain-picker__btn${current === t ? ' is-active' : ''}`}
                onClick={() => applyTerrainFromPicker(t)}
                style={{ ['--swatch' as string]: TERRAIN_COLORS[t] }}
              >
                <span className="palette__swatch" aria-hidden />
                {TERRAIN_LABELS[t]}
              </button>
            )
          })}
        </div>
      ) : null}

      <p className="editor__statusbar" role="status">
        {status}
        {` · ${formatGridSize(map)}`}
        {` · ${(viewScale * 100).toFixed(0)}%`}
        {hover ? ` · ${hover.q},${hover.r}` : ''}
      </p>
    </div>
  )
}

function loadInitialDocument(): {
  map: MapData
  align: MapImageAlign
  viewZoom: number
  viewportFit: ViewportFitMode
  layerMode: MapLayerMode
  gridOpacity: number
} {
  clearLegacyAlignStorage()

  const fallback = {
    map: createEmptyMap(),
    align: { ...AUTO_CALIBRATION },
    viewZoom: 1,
    viewportFit: 'contain' as ViewportFitMode,
    layerMode: 'both' as MapLayerMode,
    gridOpacity: 0.45,
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = parseMap(raw)
      const persist = parsed.mapAlign ?? loadAlignFromStorage()
      if (!persist) {
        return { ...fallback, map: parsed }
      }
      const viewportFit: ViewportFitMode = persist.viewportFit ?? 'contain'
      return {
        map: parsed,
        align: alignFromPersist(persist),
        viewZoom:
          viewportFit === 'free' && persist.viewZoom !== undefined
            ? clampViewZoom(persist.viewZoom)
            : 1,
        viewportFit,
        layerMode: persist.layerMode ?? 'both',
        gridOpacity: persist.gridOpacity ?? 0.45,
      }
    }
  } catch {
    // ignore corrupt storage
  }

  const alignOnly = loadAlignFromStorage()
  if (alignOnly) {
    const viewportFit: ViewportFitMode = alignOnly.viewportFit ?? 'contain'
    return {
      ...fallback,
      align: alignFromPersist(alignOnly),
      viewZoom:
        viewportFit === 'free' && alignOnly.viewZoom !== undefined
          ? clampViewZoom(alignOnly.viewZoom)
          : 1,
      viewportFit,
      layerMode: alignOnly.layerMode ?? 'both',
      gridOpacity: alignOnly.gridOpacity ?? 0.45,
    }
  }

  return fallback
}
