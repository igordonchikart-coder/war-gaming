import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type NavMenuId =
  | 'tool'
  | 'layers'
  | 'frame'
  | 'underlay'
  | 'align'
  | 'size'
  | 'file'
  | 'palette'

interface NavMenuProps {
  id: NavMenuId
  openId: NavMenuId | null
  onOpenChange: (id: NavMenuId | null) => void
  label: string
  /** Compact summary shown on the trigger (e.g. current value). */
  summary?: string
  children: ReactNode
  /** Mark trigger as active when a mode is on (e.g. calibration). */
  accent?: boolean
}

/**
 * Navbar group: click trigger opens a popover; closes on outside click or Esc.
 * Only one menu open at a time (controlled via openId).
 */
export function NavMenu({
  id,
  openId,
  onOpenChange,
  label,
  summary,
  children,
  accent = false,
}: NavMenuProps) {
  const open = openId === id
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onOpenChange(null)
      }
    }

    function onPointer(e: MouseEvent | PointerEvent) {
      const el = rootRef.current
      if (!el) return
      if (e.target instanceof Node && !el.contains(e.target)) {
        onOpenChange(null)
      }
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [open, onOpenChange])

  return (
    <div className={`nav-menu${open ? ' is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`nav-menu__trigger${accent ? ' is-accent' : ''}${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(open ? null : id)}
      >
        <span className="nav-menu__label">{label}</span>
        {summary ? <span className="nav-menu__summary">{summary}</span> : null}
      </button>
      {open ? (
        <div
          id={panelId}
          className="nav-menu__panel"
          role="dialog"
          aria-label={label}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

/** Convenience hook for exclusive navbar menus. */
export function useNavMenu() {
  const [openId, setOpenId] = useState<NavMenuId | null>(null)
  return { openId, setOpenId }
}
