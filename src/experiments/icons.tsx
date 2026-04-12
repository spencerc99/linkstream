interface IconProps {
  size?: number;
  className?: string;
}

const common = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function ReplyIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

export function RetweetIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <polyline points="17 1 21 5 17 9" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <polyline points="7 23 3 19 7 15" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function HeartIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function HeartFilledIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

export function ChartIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

export function BookmarkIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function HomeIcon({ size = 22, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export function BellIcon({ size = 22, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

export function UserIcon({ size = 22, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export function UserPlusIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="23" y1="11" x2="17" y2="11" />
    </svg>
  );
}

export function CloseIcon({ size = 18, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

export function BackIcon({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} {...common}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
