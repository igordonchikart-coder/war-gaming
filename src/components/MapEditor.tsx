import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampSize,
  createEmptyMap,
  parseMap,
  parseMapAlign,
  resizeMap,
  serializeMap,
  setTerrain,
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
  DEFAULT_MAP_SIZE,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  STORAGE_KEY,
  TERRAIN_COLORS,
  TERRAIN_LABELS,
  type MapAlignPersist,
  type MapData,
  type Terrain,
  type ViewportFitMode,
} from '../hex/types'
import { HexCanvas, MAX_VIEW_SCALE, MIN_VIEW_SCALE, type CanvasTool } from './HexCanvas'
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
    scale: align.scale,
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
    scale: persist.scale,
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const skipAutosaveRef = useRef(true)

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
    setStatus(`Сетка: ${w}×${h} (${w * h} гексов)`)
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

  function updateAlign(partial: Partial<MapImageAlign>) {
    setAlign((prev) => ({ ...prev, ...partial }))
  }

  function handleViewScaleChange(next: number) {
    setViewportFit('free')
    setViewScale(next)
  }

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
                title={`Столбцы (odd-q), ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}; по умолчанию ${DEFAULT_MAP_SIZE}`}
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
                title={`Строки (odd-q), ${MIN_MAP_SIZE}–${MAX_MAP_SIZE}; по умолчанию ${DEFAULT_MAP_SIZE}`}
              />
            </label>
            <button type="button" onClick={applySize}>
              Применить
            </button>
            <span className="size-controls__hint" title="Подписи на гексах = odd-q индекс q,r (с нуля), не печатный номер карты">
              подписи q,r
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
              title="Калибровка: ширина подложки = ширина гекс-поля (не кадр viewport)"
            >
              <input
                type="checkbox"
                checked={align.fitWidth}
                onChange={(e) => updateAlign({ fitWidth: e.target.checked })}
              />
              Fit width → сетка
            </label>
            <PrecisionField
              label="Scale"
              title="Масштаб подложки относительно сетки (не зум сцены)"
              value={align.scale}
              min={0.2}
              max={3}
              step={0.01}
              decimals={2}
              onChange={(scale) => updateAlign({ scale })}
            />
            <PrecisionField
              label="X"
              value={align.offsetX}
              min={-800}
              max={800}
              step={1}
              decimals={0}
              onChange={(offsetX) => updateAlign({ offsetX })}
            />
            <PrecisionField
              label="Y"
              value={align.offsetY}
              min={-800}
              max={800}
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
              onClick={() => {
                setAlign(DEFAULT_MAP_ALIGN)
                setGridOpacity(0.45)
                setViewportFit('contain')
              }}
            >
              Сброс
            </button>
            <button type="button" onClick={handleSaveCalibration} title="Записать scale/offset/zoom/слой в localStorage и в JSON карты">
              Сохранить калибровку
            </button>
            <span className="size-controls__hint" title="Автосохранение при изменении; также в Скачать JSON / Save LS">
              тяните шкалу или ± / число · калибровка → JSON / LS
            </span>
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
          scale: persist.scale,
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
        scale: alignOnly.scale,
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
