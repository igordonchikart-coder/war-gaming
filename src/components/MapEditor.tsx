import { useCallback, useEffect, useRef, useState } from 'react'
import { createEmptyMap, parseMap, resizeMap, serializeMap, setTerrain } from '../hex/map'
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

const TERRAINS: Terrain[] = ['plain', 'forest', 'water']

export function MapEditor() {
  const [map, setMap] = useState<MapData>(() => loadInitialMap())
  const [brush, setBrush] = useState<Terrain>('plain')
  const [hover, setHover] = useState<{ q: number; r: number } | null>(null)
  const [widthInput, setWidthInput] = useState(String(DEFAULT_MAP_SIZE))
  const [heightInput, setHeightInput] = useState(String(DEFAULT_MAP_SIZE))
  const [status, setStatus] = useState('Готово')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setWidthInput(String(map.width))
    setHeightInput(String(map.height))
  }, [map.width, map.height])

  const paint = useCallback(
    (q: number, r: number) => {
      setMap((prev) => setTerrain(prev, q, r, brush))
    },
    [brush],
  )

  function applySize() {
    const w = Number(widthInput)
    const h = Number(heightInput)
    if (!Number.isFinite(w) || !Number.isFinite(h)) {
      setStatus('Размер должен быть числом')
      return
    }
    setMap((prev) => resizeMap(prev, w, h))
    setStatus(`Размер: ${Math.round(w)}×${Math.round(h)}`)
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

  return (
    <div className="editor">
      <header className="editor__header">
        <div>
          <h1>War Gaming</h1>
          <p className="editor__subtitle">Фаза 0 — редактор гекс-карты</p>
        </div>
        <p className="editor__status" role="status">
          {status}
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
          <span className="tool-group__label">Размер</span>
          <div className="size-controls">
            <label>
              W
              <input
                type="number"
                min={MIN_MAP_SIZE}
                max={MAX_MAP_SIZE}
                value={widthInput}
                onChange={(e) => setWidthInput(e.target.value)}
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
              />
            </label>
            <button type="button" onClick={applySize}>
              Применить
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
