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
      {/* Official Media Club Emblem Badge: Solid Black Background + Crisp White Words */}
      <div
        className={cn(
          "relative flex items-center justify-center shrink-0 rounded-xl overflow-hidden shadow-xs ring-1 ring-white/10 bg-black",
          iconSizes[size]
        )}
      >
        <svg viewBox="0 0 512 512" className="w-full h-full" fill="none">
          {/* Solid Black Base & Crisp Subtle Border */}
          <rect width="512" height="512" rx="112" fill="#000000" />
          <rect width="512" height="512" rx="112" stroke="#ffffff" strokeOpacity="0.2" strokeWidth="6" />

          {/* Authentic Media Club Artwork in Pure White */}
          <g transform="translate(46, 111) scale(0.4805)">
            <path
              fillRule="evenodd"
              d={MEDIA_CLUB_PATH}
              fill="#ffffff"
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
            <span>Hub</span>
          </span>
          {showSubtitle && (
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground truncate">
              Media Club
            </span>
          )}
        </div>
      )}
    </div>
  );
}
