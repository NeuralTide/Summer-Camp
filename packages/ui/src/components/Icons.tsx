interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconHome = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9.5a1 1 0 0 0 1 1h3.5v-6h3v6H17a1 1 0 0 0 1-1V10" />
  </svg>
);

export const IconSparkle = ({ size = 20 }: IconProps) => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M11 2c.4 3 1.4 5.1 3 6.7C15.6 10.3 17.7 11.3 21 11.7v.6c-3.3.4-5.4 1.4-7 3-1.6 1.6-2.6 3.7-3 6.7h-.6c-.4-3-1.4-5.1-3-6.7C5.8 13.7 3.7 12.7.4 12.3v-.6C3.7 11.3 5.8 10.3 7.4 8.7 9 7.1 10 5 10.4 2z" />
  </svg>
);

export const IconPath = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="7" cy="6" r="2.6" />
    <circle cx="17" cy="12" r="2.6" />
    <circle cx="7" cy="18" r="2.6" />
    <path d="M9.4 7.3c2.8 1 4 2.3 5.2 3.5M14.6 13.3c-1.2 1.2-2.4 2.5-5.2 3.5" />
  </svg>
);

export const IconPlus = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconGear = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

export const IconFlame = ({ size = 17 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2s1.2 3.2-1 5.6C8.4 10.4 6 12 6 15.2 6 19 9 22 12 22s6-3 6-6.8c0-2.6-1.4-4-2.6-5.6-.5 1-1.2 1.7-2 2 .4-2.6-.4-6.6-1.4-9.6z" />
  </svg>
);

export const IconBolt = ({ size = 17 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M13.5 2 4 13.5h6L9.5 22 20 10.5h-6.5z" />
  </svg>
);

export const IconStar = ({ size = 17 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="m12 2.6 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.4l6.5-.9z" />
  </svg>
);

export const IconHeart = ({ size = 17 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 20.5s-7.5-4.7-9.3-9A5.2 5.2 0 0 1 12 6.5a5.2 5.2 0 0 1 9.3 5c-1.8 4.3-9.3 9-9.3 9z" />
  </svg>
);

export const IconLock = ({ size = 20 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 10h-1V7a4 4 0 0 0-8 0v3H7a1.6 1.6 0 0 0-1.6 1.6v7.8A1.6 1.6 0 0 0 7 21h10a1.6 1.6 0 0 0 1.6-1.6v-7.8A1.6 1.6 0 0 0 17 10zm-7-3a2 2 0 0 1 4 0v3h-4z" />
  </svg>
);

export const IconCheck = ({ size = 22 }: IconProps) => (
  <svg {...base(size)} strokeWidth={3}>
    <path d="M4 12.5 9.5 18 20 6.5" />
  </svg>
);

export const IconCross = ({ size = 22 }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.4}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconChevronUp = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m6 15 6-6 6 6" />
  </svg>
);

export const IconChevronDown = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconChevronRight = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconBook = ({ size = 22 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
  </svg>
);

export const IconDumbbell = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6.5 6.5v11M3 9v6M17.5 6.5v11M21 9v6M6.5 12h11" />
  </svg>
);

export const IconTrash = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7" />
  </svg>
);

export const IconUser = ({ size = 20 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.5 20c1.4-3.7 4.3-5.6 7.5-5.6s6.1 1.9 7.5 5.6" />
  </svg>
);

export const IconKebab = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="19" r="1.8" />
  </svg>
);

export const IconTrophy = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
    <path d="M7 5H4v1a4 4 0 0 0 4 4M17 5h3v1a4 4 0 0 1-4 4" />
    <path d="M12 14v3M9 21h6M9.5 21c0-2 1-3 2.5-4 1.5 1 2.5 2 2.5 4" />
  </svg>
);

export const IconInfo = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="8" r="0.25" fill="currentColor" stroke="currentColor" strokeWidth="1.6" />
  </svg>
);

export const IconClock = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.2 2" />
  </svg>
);

/**
 * The product mark: a campfire — flame over crossed logs in a ring of stones.
 *
 * Deliberately a wide triangle rather than the tall teardrop of IconFlame, so
 * the logo and the streak icon do not read as the same glyph at small sizes.
 * Paths are token-filled, so the mark re-tints with the theme.
 */
export const Mark = ({ size = 32 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path fill="var(--ink)" d="M 17.49 2.17 C 18.41 2.14 19.48 2.4 20.33 2.78 C 23.07 4.02 24.51 6.56 24.33 9.54 C 24.3 10.21 23.93 11.45 24.15 12 C 24.21 12.05 24.26 12.08 24.34 12.06 C 25.23 11.73 25.34 10.48 25.7 9.76 C 26.02 9.15 26.61 10.08 26.75 10.34 C 28.18 12.82 28.27 16.1 26.51 18.45 C 25.17 20.24 23.4 21.11 21.23 21.44 C 18.11 21.81 14.37 20.64 12.88 17.67 C 11.99 15.89 11.96 13.75 12.99 12.03 C 13.32 11.48 13.72 10.95 14.04 10.39 C 14.72 9.27 15.11 8.01 14.95 6.69 C 14.92 6.51 14.82 6.3 14.91 6.12 C 15.04 5.86 15.38 5.9 15.6 6.01 C 16.59 6.63 17.33 7.59 17.73 8.75 C 18.86 6.8 18.65 4.58 17.38 2.79 C 17.18 2.51 17.25 2.37 17.49 2.17 z" />
    <path fill="var(--flame)" d="M 18.39 3.01 C 19 3 19.93 3.36 20.46 3.64 C 22.62 4.82 23.86 7.18 23.6 9.62 C 23.54 10.25 23.37 10.84 23.33 11.49 C 23.28 12.35 23.77 13.05 24.7 12.69 C 25.49 12.38 25.83 11.52 26.14 10.78 C 28.74 15.81 25.62 20.74 20.02 20.78 C 17.11 20.77 13.96 19.31 13.18 16.33 C 12.81 14.92 12.92 13.38 13.76 12.16 C 14.99 10.37 15.79 9.15 15.72 6.93 C 16.09 7.29 16.41 7.71 16.67 8.17 C 16.96 8.7 17.08 9.17 17.28 9.73 C 17.33 9.89 17.62 10.09 17.77 9.97 C 18.15 9.65 18.57 8.8 18.74 8.38 C 19.31 7.03 19.36 5.52 18.87 4.13 C 18.75 3.76 18.54 3.38 18.39 3.01 z" />
    <path fill="var(--ink)" d="M 10.46 18.93 C 11.1 18.99 12.86 19.76 13.55 20.02 C 15.54 20.8 17.54 21.56 19.55 22.31 C 21.74 23.1 24 23.95 26.18 24.71 L 28.88 25.66 C 29.28 25.81 29.72 25.95 30.1 26.12 C 30.78 26.41 31.18 27.24 30.92 27.93 C 30.62 28.72 29.7 29.57 28.96 29.93 C 28.57 30.03 28.19 29.97 27.81 29.84 C 26.27 29.32 24.72 28.76 23.19 28.22 L 14.52 25.15 L 10.9 23.87 C 10.18 23.63 9.29 23.4 8.63 23.06 C 8.22 22.85 8.9 21.11 8.99 20.73 C 9.2 19.81 9.4 19.09 10.46 18.93 z" />
    <path fill="var(--ink)" d="M 18.91 30.72 C 19.03 30.71 19.15 30.71 19.27 30.71 C 20.39 30.7 23.64 31.54 24.5 32.36 C 25.42 33.24 26.07 35.56 24.88 36.57 C 23.43 37.8 21.67 37.89 19.84 37.86 C 18.02 37.79 15.63 37.95 14.14 36.77 C 12.75 35.67 12.98 33.79 14.02 32.55 C 15.22 31.13 17.17 30.87 18.91 30.72 z" />
    <path fill="var(--ink)" d="M 30.21 29.61 C 31.2 29.03 31.91 28.66 33.06 28.55 C 35.26 28.35 36.68 30.33 36.1 32.38 C 35.8 33.47 34.98 34.3 34.01 34.85 C 33.86 34.92 33.72 35 33.57 35.07 C 31.87 35.86 29.88 36.39 28.02 35.93 C 26.2 35.47 24.96 33.65 26.39 32 C 27.43 30.79 28.85 30.33 30.21 29.61 z" />
    <path fill="var(--accent)" d="M 31.11 29.83 C 31.47 29.62 31.78 29.58 32.16 29.46 C 34.16 28.84 35.93 29.97 35.4 32.18 C 35.2 33.01 34.62 33.6 33.86 34.03 C 33.82 34.05 33.77 34.08 33.73 34.1 C 33.73 33.85 33.74 33.59 33.7 33.35 C 33.64 31.89 32.48 30.34 31.11 29.83 z" />
    <path fill="var(--ink)" d="M 6.33 28.41 C 8.33 28.44 10.72 29.74 12 31.26 C 13.69 33.27 13.24 35.05 10.54 35.52 C 4.1 36.12 1.43 28.73 6.33 28.41 z" />
    <path fill="var(--ink)" d="M 29.46 18.97 C 29.7 18.98 29.96 19.01 30.18 19.14 C 31 19.69 31.09 21.12 31.42 21.99 C 31.56 22.53 31.67 23.02 30.99 23.22 C 29.64 23.61 28.13 24.25 26.77 24.56 L 23.85 23.49 C 22.8 23.11 21.75 22.72 20.71 22.32 C 21.22 22.08 22.03 21.8 22.58 21.59 L 26.18 20.2 C 26.73 19.99 28.97 19.03 29.46 18.97 z" />
    <path fill="var(--ink)" d="M 12.95 25 C 13.25 25.01 16.21 26.14 16.67 26.31 C 17.44 26.58 18.21 26.85 18.99 27.12 C 17.33 27.7 15.67 28.3 14.02 28.92 C 13.39 29.15 11.53 30.04 10.95 29.81 C 9.95 29.42 8.01 27.22 9.53 26.3 C 10.41 25.78 11.94 25.41 12.95 25 z" />
    <path fill="var(--ink)" d="M 30.99 24.01 C 32.61 23.92 34.15 25.1 34.53 26.66 C 34.66 27.17 34.67 27.54 34.65 28.06 L 33.01 28.04 C 32.73 28.03 32.45 28.04 32.17 28.04 C 31.89 26.06 30.89 25.32 29.16 24.53 C 29.93 24.24 30.14 24.08 30.99 24.01 z" />
    <path fill="var(--ink)" d="M 8.49 24.04 C 9.35 23.91 10.07 24.17 10.81 24.56 C 9.57 25.09 8.56 25.71 8.11 27.09 C 8.04 27.31 7.98 27.9 7.91 28.02 L 7.77 28.03 C 6.98 28.02 6.19 28.03 5.4 28.06 C 5.24 26.02 6.43 24.35 8.49 24.04 z" />
  </svg>
);
