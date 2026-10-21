import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clampSize,
  createEmptyMap,
  parseMap,
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
  DEFAULT_MAP_SIZE,
  MAX_MAP_SIZE,
  MIN_MAP_SIZE,
  STORAGE_KEY,
  TERRAIN_COLORS,
  TERRAIN_LABELS,
  type MapData,
  type Terrain,
} from '../hex/types'
import { HexCanvas } from './HexCanvas'

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

export function MapEditor() {
  const [map, setMap] = useState<MapData>(() => loadInitialMap())
  const [brush, setBrush] = useState<Terrain>('plain')
  const [hover, setHover] = useState<{ q: number; r: number } | null>(null)
  const [widthInput, setWidthInput] = useState(String(DEFAULT_MAP_SIZE))
  const [heightInput, setHeightInput] = useState(String(DEFAULT_MAP_SIZE))
  const [status, setStatus] = useState('Готово')
  const [layerMode, setLayerMode] = useState<MapLayerMode>('both')
  const [align, setAlign] = useState<MapImageAlign>(DEFAULT_MAP_ALIGN)
  const [gridOpacity, setGridOpacity] = useState(0.45)
  const [mapImages, setMapImages] = useState<LoadedMapImage[]>([])
  const [viewScale, setViewScale] = useState(1)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setWidthInput(String(map.width))
    setHeightInput(String(map.height))
  }, [map.width, map.height])

  useEffect(() => {
    let cancelled = false
    setStatus('Загрузка подложки…')
    loadMapImagesProgressive(undefined, undefined, (loaded, index, total) => {
      if (cancelled) return
      setStatus(
        `Подложка ${index + 1}/${total}` +
          (loaded.downscaled ? ' (даунскейл)' : '') +
          ` · ${loaded.naturalWidth}×${loaded.naturalHeight} px`,
      )
    })
      .then((images) => {
        if (cancelled) return
        setMapImages(images)
        setStatus(
          images.length
            ? `Подложка: ${images.map((i) => i.url).join(', ')}`
            : 'Подложка не найдена (см. public/map/README.md)',
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
  }, [])

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
    const json = serializeMap(map)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `war-gaming-map-${map.width}x${map.height}.json`
    a.click()
    URL.revokeObjectURL(url)
    setStatus('Карта скачана')
  }

  function handleSaveLocal() {
    localStorage.setItem(STORAGE_KEY, serializeMap(map))
    setStatus('Сохранено в localStorage')
  }

  function handleLoadLocal() {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      setStatus('В localStorage нет карты')
      return
    }
    try {
      setMap(parseMap(raw))
      setStatus('Загружено из localStorage')
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Ошибка загрузки')
    }
  }

  function handleLoadFile(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        setMap(parseMap(text))
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
        <section className="tool-group" aria-label="Палитра тайлов">
          <span className="tool-group__label">Тайл</span>
          <div className="palette">
            {TERRAINS.map((t) => (
              <button
                key={t}
                type="button"
                className={`palette__btn${brush === t ? ' is-active' : ''}`}
                onClick={() => setBrush(t)}
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
          </div>
        </section>

        <section className="tool-group" aria-label="Выравнивание карты">
          <span className="tool-group__label">Выравнивание</span>
          <div className="align-controls">
            <label className="align-controls__check">
              <input
                type="checkbox"
                checked={align.fitWidth}
                onChange={(e) => updateAlign({ fitWidth: e.target.checked })}
              />
              Fit width
            </label>
            <label title="Масштаб только подложки относительно сетки (не зум сцены)">
              Scale подложки
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.01}
                value={align.scale}
                onChange={(e) => updateAlign({ scale: Number(e.target.value) })}
              />
              <span className="align-controls__value">{align.scale.toFixed(2)}</span>
            </label>
            <label>
              X
              <input
                type="range"
                min={-400}
                max={400}
                step={1}
                value={align.offsetX}
                onChange={(e) => updateAlign({ offsetX: Number(e.target.value) })}
              />
              <span className="align-controls__value">{align.offsetX}</span>
            </label>
            <label>
              Y
              <input
                type="range"
                min={-400}
                max={400}
                step={1}
                value={align.offsetY}
                onChange={(e) => updateAlign({ offsetY: Number(e.target.value) })}
              />
              <span className="align-controls__value">{align.offsetY}</span>
            </label>
            <label>
              Сетка α
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={gridOpacity}
                onChange={(e) => setGridOpacity(Number(e.target.value))}
                disabled={layerMode === 'map'}
              />
              <span className="align-controls__value">{gridOpacity.toFixed(2)}</span>
            </label>
            <button
              type="button"
              onClick={() => {
                setAlign(DEFAULT_MAP_ALIGN)
                setGridOpacity(0.45)
              }}
            >
              Сброс
            </button>
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
          onViewScaleChange={setViewScale}
        />
      </div>
    </div>
  )
}

function loadInitialMap(): MapData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return parseMap(raw)
  } catch {
    // ignore corrupt storage
  }
  return createEmptyMap()
}
