import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BackdropLayer, OverlayContent, OverlayState } from '@shared/overlay'
import { AgentSheetView } from './AgentSheet'
import { ErrorsView } from './ErrorsPopover'
import { MenuView } from './MenuView'
import { PromptCard } from './PromptCard'

/** A key that changes when a different surface (or another question) takes the overlay. */
function surfaceKey(content: OverlayContent): string {
  if (content.kind === 'prompt') return `prompt-${content.prompt.id}`
  if (content.kind === 'menu') return `menu-${content.menu.id}`
  return content.kind
}

/**
 * The overlay view: one surface (the agent sheet, the errors popover, a question or a menu) placed where
 * main says, on a clear page. Main sizes the view to the surface; the surface reports its height.
 */
export function OverlayApp(): React.JSX.Element | null {
  const [state, setState] = useState<OverlayState | null>(null)
  const [backdrop, setBackdrop] = useState<BackdropLayer[]>([])
  const surfaceRef = useRef<HTMLDivElement>(null)
  const content = state?.content ?? null
  const key = content ? surfaceKey(content) : null

  useEffect(() => {
    const unsubscribe = window.overlay.onState(setState)
    window.overlay.ready()
    return unsubscribe
  }, [])

  // The frosted backdrop: shown once its images are decoded, so a refresh never flickers.
  useEffect(() => {
    let latest = 0
    return window.overlay.onBackdrop((layers) => {
      const round = ++latest
      const decoded = layers.map((layer) => {
        const image = new Image()
        image.src = layer.src
        return image.decode().catch(() => undefined)
      })
      void Promise.all(decoded).then(() => {
        if (round === latest) setBackdrop(layers)
      })
    })
  }, [])

  // Esc closes a popover, and answers a question with its cancel button.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        window.overlay.close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Main fits the view to the surface's height.
  useLayoutEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    let reported = -1
    const report = (): void => {
      const height = Math.ceil(surface.getBoundingClientRect().height)
      if (height === reported) return
      reported = height
      window.overlay.setHeight(height)
    }
    const observer = new ResizeObserver(report)
    observer.observe(surface)
    report()
    return () => observer.disconnect()
  }, [key])

  if (!state || !content) return null

  return (
    <div
      className="fixed inset-0"
      onPointerDown={(event) => {
        // Beside the surface (the room left for its shadow): a popover closes, a question stays.
        if (event.target === event.currentTarget && content.kind !== 'prompt') {
          window.overlay.close()
        }
      }}
    >
      <div
        ref={surfaceRef}
        key={key}
        data-kind={content.kind}
        data-frosted={backdrop.length > 0 || undefined}
        role={
          content.kind === 'menu' ? undefined : content.kind === 'prompt' ? 'alertdialog' : 'dialog'
        }
        aria-label={
          content.kind === 'agent' ? 'Agents' : content.kind === 'errors' ? 'New errors' : undefined
        }
        className="pop-surface absolute flex flex-col overflow-hidden rounded-xl bg-pop text-ink"
        style={{
          top: state.inset.top,
          left: state.inset.left,
          width: state.width,
          maxHeight: state.maxHeight ?? undefined
        }}
      >
        {backdrop.length > 0 && (
          <div aria-hidden="true" className="pop-backdrop">
            <div className="pop-backdrop-images">
              {backdrop.map((layer, index) => (
                <img
                  key={index}
                  src={layer.src}
                  alt=""
                  style={{ left: layer.x, top: layer.y, width: layer.width, height: layer.height }}
                />
              ))}
            </div>
          </div>
        )}
        {content.kind === 'agent' && <AgentSheetView sheet={content.sheet} />}
        {content.kind === 'errors' && <ErrorsView errors={content.errors} />}
        {content.kind === 'prompt' && <PromptCard prompt={content.prompt} />}
        {content.kind === 'menu' && <MenuView menu={content.menu} />}
      </div>
    </div>
  )
}
