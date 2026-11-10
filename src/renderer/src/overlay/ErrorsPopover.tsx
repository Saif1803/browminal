import type { ErrorsPopover } from '@shared/overlay'
import { FailureIcon, SuccessIcon } from '../components/icons'
import { Button } from './controls'

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** After Send: where the errors went. */
function Sent({
  sent,
  count
}: {
  sent: NonNullable<ErrorsPopover['sent']>
  count: number
}): React.JSX.Element {
  const failed = sent.error !== null
  const them = count === 1 ? 'The error is' : `The ${count} errors are`
  return (
    <div role="status" className="flex items-start gap-3 p-4">
      {failed ? (
        <FailureIcon size={20} className="mt-px shrink-0 text-danger" />
      ) : (
        <SuccessIcon size={20} className="mt-px shrink-0 text-ok" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold">
          {failed ? 'Couldn’t send the errors' : 'Sent to your agent'}
        </span>
        <span className="leading-normal text-pretty text-ink-muted">
          {failed
            ? sent.error
            : sent.typed
              ? `${them} in the agent’s prompt. The badge clears until new errors appear.`
              : `Saved as pick ${sent.pick}: ask your agent to look at it. The badge clears until new errors appear.`}
        </span>
      </div>
    </div>
  )
}

/**
 * The errors popover, hanging from the address bar's errors badge: the page's new errors
 * themselves, so the user can tell whether they're worth sending.
 */
export function ErrorsView({ errors }: { errors: ErrorsPopover }): React.JSX.Element {
  if (errors.sent) return <Sent sent={errors.sent} count={errors.count} />
  const more = errors.count - errors.rows.length
  return (
    <>
      <div className="flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5">
        <h2 className="m-0 text-[14px] font-semibold">
          {plural(errors.count, 'new error')} on this page
        </h2>
        <span className="truncate text-[12px] text-ink-muted">{errors.title}</span>
      </div>
      <ul className="m-0 flex list-none flex-col border-t border-line p-0">
        {errors.rows.map((row, index) => {
          const meta = [row.place, row.count > 1 ? `${row.count}×` : null].filter(Boolean)
          return (
            <li
              key={index}
              className="flex flex-col gap-[3px] border-b border-line px-4 py-2.5 last:border-b-0"
            >
              <span className="line-clamp-3 font-mono text-[11.5px] leading-normal break-words text-danger select-text">
                {row.message}
              </span>
              {meta.length > 0 && (
                <span className="text-[11.5px] text-ink-faint">{meta.join(' · ')}</span>
              )}
            </li>
          )
        })}
        {errors.rows.length === 0 && (
          <li className="px-4 py-2.5 text-[12px] text-ink-faint">Reading the errors…</li>
        )}
        {more > 0 && errors.rows.length > 0 && (
          <li className="border-t border-line px-4 py-2 text-[11.5px] text-ink-faint">
            and {plural(more, 'more')}
          </li>
        )}
      </ul>
      <div className="flex items-center gap-2 border-t border-line bg-field/50 px-4 py-3">
        <span className="flex-1 text-[12px] text-ink-faint">Esc to close</span>
        <Button tone="quiet" onClick={() => window.overlay.dismissErrors()} className="px-3">
          Dismiss
        </Button>
        <Button tone="accent" autoFocus onClick={() => window.overlay.sendErrors()}>
          Send to agent
        </Button>
      </div>
    </>
  )
}
