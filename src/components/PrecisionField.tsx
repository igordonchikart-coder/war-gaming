import { useId } from 'react'

interface PrecisionFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  /** Display / number-input decimals. Defaults from step. */
  decimals?: number
  disabled?: boolean
  title?: string
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

function decimalsFromStep(step: number): number {
  const s = String(step)
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/**
 * Native range (smooth drag) + number input + ± nudges for precise calibration.
 */
export function PrecisionField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  decimals,
  disabled = false,
  title,
}: PrecisionFieldProps) {
  const id = useId()
  const places = decimals ?? decimalsFromStep(step)
  const shown = Number.isFinite(value) ? value.toFixed(places) : ''

  function commit(raw: number) {
    if (!Number.isFinite(raw)) return
    const rounded = places > 0 ? Number(raw.toFixed(places)) : Math.round(raw)
    onChange(clamp(rounded, min, max))
  }

  function nudge(dir: -1 | 1) {
    commit(value + dir * step)
  }

  return (
    <div className="precision-field" title={title}>
      <label className="precision-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="precision-field__range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={clamp(value, min, max)}
        disabled={disabled}
        onChange={(e) => commit(Number(e.target.value))}
      />
      <div className="precision-field__exact">
        <button
          type="button"
          className="precision-field__nudge"
          disabled={disabled || value <= min}
          onClick={() => nudge(-1)}
          aria-label={`${label}: меньше`}
        >
          −
        </button>
        <input
          className="precision-field__number"
          type="number"
          min={min}
          max={max}
          step={step}
          value={shown}
          disabled={disabled}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) commit(n)
          }}
          onBlur={(e) => {
            const n = Number(e.target.value)
            commit(Number.isFinite(n) ? n : value)
          }}
        />
        <button
          type="button"
          className="precision-field__nudge"
          disabled={disabled || value >= max}
          onClick={() => nudge(1)}
          aria-label={`${label}: больше`}
        >
          +
        </button>
      </div>
    </div>
  )
}
