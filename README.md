# War Gaming

Браузерный прототип пошаговой стратегии. **Фаза 0** — редактор гекс-карты.

## Запуск

```bash
npm install
npm run dev
```

Сборка:

```bash
npm run build
```

## Редактор карты

- Гекс-сетка (flat-top odd-q `q,r`) на Canvas
- Подложка карты из `public/map/` (WebP/PNG) с выравниванием scale/offset и режимами «карта / сетка / оба»
- Зум сцены: trackpad pinch / touch pinch / Ctrl+колёсико (якорь под курсором)
- Палитра: равнина / лес / вода — рисование кликом и перетаскиванием
- Размер сетки настраивается (4–64), в UI показано реальное число гексов `W×H`
- Save/Load: скачать JSON, открыть файл, localStorage

Инструкция по экспорту большой карты: [`public/map/README.md`](public/map/README.md).

Формат JSON:

```json
{
  "version": 1,
  "width": 12,
  "height": 12,
  "tiles": ["plain", "forest", "..."]
}
```

`tiles` — плоский массив длиной `width * height`, индекс `r * width + q`.
