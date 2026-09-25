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
