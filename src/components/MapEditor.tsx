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
  parseMap,
  parseMapAlign,
  resizeMap,
  serializeMap,
  setTerrain,
  suggestGridSizeForUnderlay,
} from '../hex/map'
import {
  DEFAULT_MAP_ALIGN,
  loadMapImagesProgressive,
  type LoadedMapImage,
  type MapImageAlign,
  type MapLayerMode,
} from '../hex/mapImage'
import {
  ALIGN_STORAGE_KEY,
  DEFAULT_MAP_HEIGHT,
  DEFAULT_MAP_WIDTH,
  LABEL_CELL_LIMIT,
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
import { PrecisionField } from './PrecisionField'

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
    fitWidth: align.fitWidth,
    viewZoom,
    viewportFit,
    layerMode,
    gridOpacity,
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
  setters.setAlign({
    scaleX: persist.scaleX,
    scaleY: persist.scaleY,
    offsetX: persist.offsetX,
    offsetY: persist.offsetY,
    fitWidth: persist.fitWidth,
  })
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
  const [calibPhase, setCalibPhase] = useState<CalibPhase | null>(null)
  const [calibMap1, setCalibMap1] = useState<CalibPoint | null>(null)
  const [calibMap2, setCalibMap2] = useState<CalibPoint | null>(null)
  const [calibHex1, setCalibHex1] = useState<CalibHex | null>(null)
  const [calibHex2, setCalibHex2] = useState<CalibHex | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const skipAutosaveRef = useRef(true)
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
    setStatus(fastUnderlay ? 'Загрузка подложки (быстрая)…' : 'Загрузка подложки (FULL)…')
    loadMapImagesProgressive(
      undefined,
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
          `Подложка ${quality} · ${primary.url} · ${primary.naturalWidth}×${primary.naturalHeight} px` +
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
  }, [fastUnderlay])

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

  const paint = useCallback(
    (q: number, r: number) => {
      setMap((prev) => setTerrain(prev, q, r, brush))
    },
    [brush],
  )

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

  function handleSaveDownload() {
    const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
    const json = serializeMap(doc)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `war-gaming-map-${map.width}x${map.height}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Карта + калибровка скачаны (mapAlign в JSON)')
  }

  function handleSaveLocal() {
    const doc = mapWithAlign(map, align, viewScale, layerMode, gridOpacity, viewportFit)
    localStorage.setItem(STORAGE_KEY, serializeMap(doc))
    localStorage.setItem(ALIGN_STORAGE_KEY, JSON.stringify(doc.mapAlign))
    setStatus('Сохранено в localStorage (карта + калибровка)')
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

  return (
    <div className="editor">
      <header className="editor__header">
        <div>
          <h1>War Gaming</h1>
          <p className="editor__subtitle">Фаза 0 — редактор гекс-карты</p>
        </div>
        <p className="editor__status" role="status">
          {status}
          {` · сетка ${formatGridSize(map)}`}
          {` · зум ${(viewScale * 100).toFixed(0)}%`}
          {hover ? ` · гекс ${hover.q},${hover.r}` : ''}
        </p>
      </header>

      <div className="editor__toolbar">
        <section className="tool-group" aria-label="Инструмент">
          <span className="tool-group__label">Инструмент</span>
          <div className="layer-controls">
            <button
              type="button"
              className={tool === 'paint' ? 'is-active' : ''}
              onClick={() => setTool('paint')}
              title="ЛКМ — рисовать тайл"
            >
              Кисть
            </button>
            <button
              type="button"
              className={tool === 'pan' ? 'is-active' : ''}
              onClick={() => setTool('pan')}
              title="ЛКМ — двигать карту (также Space+drag / СКМ)"
            >
              Рука
            </button>
          </div>
        </section>

        <section className="tool-group" aria-label="Палитра тайлов">
          <span className="tool-group__label">Тайл</span>
          <div className="palette">
            {TERRAINS.map((t) => (
              <button
                key={t}
                type="button"
                className={`palette__btn${brush === t ? ' is-active' : ''}`}
                onClick={() => {
                  setBrush(t)
                  setTool('paint')
                }}
                style={{ ['--swatch' as string]: TERRAIN_COLORS[t] }}
              >
                <span className="palette__swatch" aria-hidden />
                {TERRAIN_LABELS[t]}
              </button>
            ))}
          </div>
        </section>

        <section className="tool-group" aria-label="Размер карты">
          <span className="tool-group__label">
            Размер сетки · {map.width}×{map.height} = {map.tiles.length} гексов
            {(map.width > WARN_MAP_SIZE || map.height > WARN_MAP_SIZE) && (
              <span className="size-controls__warn"> · &gt;{WARN_MAP_SIZE}</span>
            )}
          </span>
          <div className="size-controls">
            <label>
              W
              <input
                type="number"
                min={MIN_MAP_SIZE}
                max={MAX_MAP_SIZE}
                value={widthInput}
                onChange={(e) => setWidthInput(e.target.value)}
                title={`Столбцы (odd-q), ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}; по умолчанию ${DEFAULT_MAP_WIDTH}; предупреждение при >${WARN_MAP_SIZE}`}
              />
            </label>
            <label>
              H
              <input
                type="number"
                min={MIN_MAP_SIZE}
                max={MAX_MAP_SIZE}
                value={heightInput}
                onChange={(e) => setHeightInput(e.target.value)}
                title={`Строки (odd-q), ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}; по умолчанию ${DEFAULT_MAP_HEIGHT}; предупреждение при >${WARN_MAP_SIZE}`}
              />
            </label>
            <button type="button" onClick={applySize}>
              Применить
            </button>
            <button
              type="button"
              onClick={applySizeFromUnderlay}
              disabled={mapImages.length === 0}
              title="Подобрать H под aspect подложки, сохранив текущий W (или дефолт). Сетка сможет покрыть лист при Fit width."
            >
              По подложке
            </button>
            <span
              className="size-controls__hint"
              title={`Подписи q,r на гексах (0-based odd-q). Скрываются при >${LABEL_CELL_LIMIT} клеток. Потолок ${MAX_MAP_SIZE}, мягкое предупреждение >${WARN_MAP_SIZE}.`}
            >
              {map.tiles.length > LABEL_CELL_LIMIT ? 'без подписей (LOD)' : 'подписи q,r'}
            </span>
          </div>
        </section>

        <section className="tool-group" aria-label="Слои подложки">
          <span className="tool-group__label">Слои</span>
          <div className="layer-controls">
            {LAYER_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={layerMode === opt.id ? 'is-active' : ''}
                onClick={() => setLayerMode(opt.id)}
              >
                {opt.label}
              </button>
            ))}
            <label
              className="align-controls__check"
              title="По умолчанию FULL: /map.webp без даунскейла. Включите только если тормозит."
            >
              <input
                type="checkbox"
                checked={fastUnderlay}
                onChange={(e) => setFastUnderlay(e.target.checked)}
              />
              Быстрая подложка
            </label>
          </div>
        </section>

        <section className="tool-group" aria-label="Кадр карты">
          <span className="tool-group__label">Кадр</span>
          <div className="layer-controls">
            <button
              type="button"
              className={viewportFit === 'contain' ? 'is-active' : ''}
              onClick={() => setViewportFit('contain')}
              title="Показать весь лист map.webp в области холста (contain, с letterbox)"
            >
              Вся карта
            </button>
            <button
              type="button"
              className={viewportFit === 'width' ? 'is-active' : ''}
              onClick={() => setViewportFit('width')}
              title="Подогнать ширину листа под холст (низ может требовать прокрутки)"
            >
              По ширине
            </button>
            <span className="size-controls__hint" title="Щипок / Zoom переводят в ручной режим">
              {viewportFit === 'free' ? 'ручной зум' : viewportFit === 'contain' ? 'весь лист' : 'по ширине'}
            </span>
          </div>
        </section>

        <section className="tool-group tool-group--align" aria-label="Выравнивание карты">
          <span className="tool-group__label">Выравнивание</span>
          <div className="align-controls">
            <label
              className="align-controls__check"
              title="Старт: ширина подложки = ширина гекс-поля. Ручной Scale X/Y или калибровка 2 точки выключают Fit (значения запекаются)."
            >
              <input
                type="checkbox"
                checked={align.fitWidth}
                onChange={(e) => {
                  const on = e.target.checked
                  if (on) {
                    // Fit again as a fresh start (relative multipliers ≈ 1).
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
            <PrecisionField
              label="Scale X"
              title="Горизонтальный масштаб подложки относительно сетки (не зум сцены). Ручная правка выключает Fit."
              value={align.scaleX}
              min={0.05}
              max={3}
              step={0.01}
              decimals={2}
              onChange={(scaleX) => updateAlign({ scaleX })}
            />
            <PrecisionField
              label="Scale Y"
              title="Вертикальный масштаб (растяжение). Если слева ровно, а справа уезжает — крутите Scale Y."
              value={align.scaleY}
              min={0.05}
              max={3}
              step={0.01}
              decimals={2}
              onChange={(scaleY) => updateAlign({ scaleY })}
            />
            <PrecisionField
              label="X"
              value={align.offsetX}
              min={-4000}
              max={4000}
              step={1}
              decimals={0}
              onChange={(offsetX) => updateAlign({ offsetX })}
            />
            <PrecisionField
              label="Y"
              value={align.offsetY}
              min={-4000}
              max={4000}
              step={1}
              decimals={0}
              onChange={(offsetY) => updateAlign({ offsetY })}
            />
            <PrecisionField
              label="Zoom"
              title="Зум сцены (щипок / Ctrl+колёсико / шкала). Сбрасывает авто-кадр в ручной режим"
              value={viewScale}
              min={MIN_VIEW_SCALE}
              max={MAX_VIEW_SCALE}
              step={0.01}
              decimals={2}
              onChange={handleViewScaleChange}
            />
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
            <button
              type="button"
              className="is-active"
              onClick={() => {
                void handleAutoCalibrate()
              }}
              title="Применить автокалибровку map.webp (scaleX/Y + offset, сетка 69×51). Погрешность ~0.15 гекса."
            >
              Автокалибровка
            </button>
            <button
              type="button"
              className={calibPhase ? 'is-active' : ''}
              onClick={() => (calibPhase ? cancelTwoPointCalib() : startTwoPointCalib())}
              title="Две точки на печатной сетке + два гекса оверлея → scaleX/Y + offset (без вращения)"
            >
              {calibPhase ? 'Отмена привязки' : 'Калибровка 2 точки'}
            </button>
            <button
              type="button"
              onClick={() => {
                resetCalibrationSession()
                setAlign({ ...AUTO_CALIBRATION })
                setGridOpacity(0.45)
                setViewportFit('contain')
              }}
              title="Вернуть встроенную автокалибровку (не Fit width)"
            >
              Сброс
            </button>
            <button
              type="button"
              onClick={handleSaveCalibration}
              title="Записать scaleX/Y/offset/zoom/слой в localStorage и в JSON карты"
            >
              Сохранить калибровку
            </button>
            <p className="align-controls__hint" role="note">
              Один клик: «Автокалибровка» (или Load <code>public/map/map-align-autocal.json</code>).
              Погрешность ≈0.15 гекса — дальние углы дожмите «Калибровка 2 точки» / Scale Y.
              Fit width — только грубый старт; ручной Scale его выключает.
            </p>
          </div>
        </section>

        <section className="tool-group" aria-label="Сохранение">
          <span className="tool-group__label">Файл</span>
          <div className="file-controls">
            <button type="button" onClick={handleNew}>
              Новая
            </button>
            <button type="button" onClick={handleSaveDownload}>
              Скачать JSON
            </button>
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Открыть файл
            </button>
            <button type="button" onClick={handleSaveLocal}>
              Save LS
            </button>
            <button type="button" onClick={handleLoadLocal}>
              Load LS
            </button>
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
          </div>
        </section>
      </div>

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
            // Pinch / ctrl-wheel inside canvas already marks free via onViewportFitChange.
            setViewScale(scale)
          }}
          tool={tool}
          viewportFit={viewportFit}
          onViewportFitChange={setViewportFit}
          calibPhase={calibPhase}
          calibMarkers={calibMarkers}
          onCalibMapClick={handleCalibMapClick}
          onCalibHexClick={handleCalibHexClick}
        />
      </div>
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
  const fallback = {
    map: createEmptyMap(),
    align: { ...DEFAULT_MAP_ALIGN },
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
        align: {
          scaleX: persist.scaleX,
          scaleY: persist.scaleY,
          offsetX: persist.offsetX,
          offsetY: persist.offsetY,
          fitWidth: persist.fitWidth,
        },
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
      align: {
        scaleX: alignOnly.scaleX,
        scaleY: alignOnly.scaleY,
        offsetX: alignOnly.offsetX,
        offsetY: alignOnly.offsetY,
        fitWidth: alignOnly.fitWidth,
      },
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
