import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const BackIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M15 18l-6-6 6-6" />
  </Icon>
)

export const ForwardIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9 18l6-6-6-6" />
  </Icon>
)

export const ReloadIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Icon>
)

export const StopIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </Icon>
)

export const HomeIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5.5 8.5V20h13V8.5" />
  </Icon>
)

export const LockIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="2.2" {...p}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </Icon>
)

export const SearchIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="2.2" {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </Icon>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const CloseIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="2.4" {...p}>
    <path d="M17 7L7 17M7 7l10 10" />
  </Icon>
)

export const GlobeIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.8" {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
  </Icon>
)

export const SpeakerIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
)

export const MutedIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
)

export const ChevronUpIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 15l6-6 6 6" />
  </Icon>
)

export const ChevronDownIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
)

/** A window split top and bottom: the panel under the page. */
export const PanelBottomIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <path d="M3.5 14.5h17" />
  </Icon>
)

/** A window split left and right: the panel beside the page. */
export const PanelRightIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <path d="M14.5 4v16" />
  </Icon>
)

export const DownloadIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5" />
    <path d="M5 19.5h14" />
  </Icon>
)

export const StarIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </Icon>
)

export const ChevronsRightIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 7l5 5-5 5M13 7l5 5-5 5" />
  </Icon>
)

export const ShieldIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z" />
  </Icon>
)

export const ShieldOffIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M19.5 13.5c-.7 3.6-3.6 6.5-7.5 7.5-4.3-1.2-7.5-4.9-7.5-9.5V6l1.5-.6M9 3.9 12 3l7.5 3v4" />
    <path d="M3 3l18 18" />
  </Icon>
)

/** A spark: agents (the agent button, a tab shared with them, the terminal's Claude button). */
export const AgentIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M12 3.5c.6 4.2 2.3 5.9 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5 4.2-.6 5.9-2.3 6.5-6.5z" />
    <path d="M18.5 15.5c.25 1.6.9 2.25 2.5 2.5-1.6.25-2.25.9-2.5 2.5-.25-1.6-.9-2.25-2.5-2.5 1.6-.25 2.25-.9 2.5-2.5z" />
  </Icon>
)

/** A warning triangle: the page's errors badge. */
export const ErrorIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="2" {...p}>
    <path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Icon>
)

/** A pointer on a box: picking an element for agents. */
export const PickIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M10 20.5H5.5a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2V10" />
    <path d="M13 13l2.6 8 1.6-3.4 3.4-1.6z" />
  </Icon>
)

/** A terminal prompt: the terminal panel. */
export const TerminalIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
  </Icon>
)

export const FolderIcon = (p: IconProps): React.JSX.Element => (
  <Icon strokeWidth="1.9" {...p}>
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Icon>
)
