import React from "react";
import { cn } from "@/lib/utils";
import { MEDIA_CLUB_PATH } from "@/components/MediaClubLogo";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  showSubtitle?: boolean;
  iconOnly?: boolean;
  textClassName?: string;
}

export function Logo({
  size = "md",
  showText = true,
  showSubtitle = false,
  iconOnly = false,
  className,
  textClassName,
  ...props
}: LogoProps) {
  const iconSizes = {
    xs: "h-5 w-5",
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-10 w-10",
    xl: "h-12 w-12",
  };

  const textSizes = {
    xs: "text-sm",
    sm: "text-base",
    md: "text-lg",
    lg: "text-xl",
    xl: "text-2xl",
  };

  return (
    <div className={cn("flex items-center gap-2.5 min-w-0 select-none", className)} {...props}>
      {/* Official Media Club Emblem Badge */}
      <div
        className={cn(
          "relative flex items-center justify-center shrink-0 rounded-xl overflow-hidden shadow-xs ring-1 ring-border/50 bg-[#0b0f19]",
          iconSizes[size]
        )}
      >
        <svg viewBox="0 0 512 512" className="w-full h-full" fill="none">
          <defs>
            <linearGradient id="logoBgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0b0f19" />
              <stop offset="50%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
            <linearGradient id="logoBorderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
              <stop offset="50%" stopColor="#818cf8" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#c084fc" stopOpacity="0.9" />
            </linearGradient>
            <linearGradient id="logoArtworkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="50%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#c084fc" />
            </linearGradient>
            <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.3" />
              <stop offset="70%" stopColor="#818cf8" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* Squircle base and border */}
          <rect width="512" height="512" rx="112" fill="url(#logoBgGrad)" />
          <rect width="512" height="512" rx="112" fill="url(#logoGlow)" />
          <rect width="512" height="512" rx="112" stroke="url(#logoBorderGrad)" strokeWidth="8" />

          {/* Authentic Media Club Artwork Vector */}
          <g transform="translate(46, 111) scale(0.4805)">
            <path
              fillRule="evenodd"
              d={MEDIA_CLUB_PATH}
              fill="url(#logoArtworkGrad)"
            />
          </g>
        </svg>
      </div>

      {/* Typography */}
      {showText && !iconOnly && (
        <div className="flex flex-col min-w-0 justify-center leading-none">
          <span
            className={cn(
              "font-extrabold tracking-tight truncate flex items-center gap-0.5 text-foreground leading-tight",
              textSizes[size],
              textClassName
            )}
          >
            <span>Media</span>
            <span className="bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-600 bg-clip-text text-transparent">
              Hub
            </span>
          </span>
          {showSubtitle && (
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground/80 truncate">
              Media Club
            </span>
          )}
        </div>
      )}
    </div>
  );
}
