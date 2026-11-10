import type { PromptIcon, PromptView } from '@shared/overlay'
import {
  AgentIcon,
  CameraIcon,
  ClipboardIcon,
  ExternalLinkIcon,
  LocationIcon,
  MicrophoneIcon,
  NotificationsIcon
} from '../components/icons'
import { Button } from './controls'

/** What each question is about, by the icon main names. */
const MARKS: Record<PromptIcon, (props: { size?: number }) => React.JSX.Element> = {
  camera: CameraIcon,
  microphone: MicrophoneIcon,
  location: LocationIcon,
  notifications: NotificationsIcon,
  clipboard: ClipboardIcon,
  link: ExternalLinkIcon,
  agent: AgentIcon
}

/** The mark of what a question is about: a camera, a pin, a bell… */
function Mark({ icon }: { icon: PromptIcon }): React.JSX.Element {
  const Glyph = MARKS[icon]
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-accent/12 text-accent"
    >
      <Glyph size={16} />
    </span>
  )
}

/**
 * A question for the user, hanging from the address bar: a site asking for a permission or to
 * open another app, or an agent asking to do something destructive. Its buttons say what they
 * do; Esc is the cancel button.
 */
export function PromptCard({ prompt }: { prompt: PromptView }): React.JSX.Element {
  const answer = (confirmed: boolean): void => window.overlay.answer(prompt.id, confirmed)
  const titleId = `prompt-${prompt.id}-title`
  // Enter answers like the old dialogs did: Block for a permission, Cancel for an agent's
  // request, Open for a link the user just clicked.
  const enterConfirms = prompt.icon === 'link'
  return (
    <div aria-labelledby={titleId} className="flex flex-col gap-3.5 p-4">
      {prompt.fromAgent && (
        <span className="flex h-[22px] items-center gap-1.5 self-start rounded-full bg-accent/12 px-2.5 text-[12px] font-semibold text-accent">
          <AgentIcon size={12} />
          Agent request
        </span>
      )}
      <div className="flex items-start gap-3">
        {!prompt.fromAgent && <Mark icon={prompt.icon} />}
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span id={titleId} className="text-[14px] leading-[1.4] break-words">
            {prompt.site && <span className="font-semibold">{prompt.site} </span>}
            {prompt.message}
          </span>
          {prompt.detail && (
            <span
              className={`leading-normal text-pretty text-ink-muted ${prompt.fromAgent ? '' : 'text-[12px]'}`}
            >
              {prompt.detail}
            </span>
          )}
        </div>
      </div>
      {prompt.code && (
        <code className="block rounded-[7px] bg-code px-2.5 py-2 font-mono text-[11.5px] break-all text-ink-muted ring-1 ring-line ring-inset select-text">
          {prompt.code}
        </code>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={() => answer(false)} autoFocus={!enterConfirms}>
          {prompt.cancel}
        </Button>
        <Button
          tone={prompt.destructive ? 'danger' : 'accent'}
          onClick={() => answer(true)}
          autoFocus={enterConfirms}
          className="px-4"
        >
          {prompt.confirm}
        </Button>
      </div>
    </div>
  )
}
