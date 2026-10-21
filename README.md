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

- Гекс-сетка (axial `q,r`) на Canvas
- Палитра: равнина / лес / вода — рисование кликом и перетаскиванием
- Размер карты настраивается (4–32)
- Save/Load: скачать JSON, открыть файл, localStorage

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
