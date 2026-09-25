"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

interface UserLinkProps {
  name?: string | null;
  username?: string | null;
  userId?: number | null;
  className?: string;
  showIcon?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
}

export function UserLink({
  name,
  username,
  userId,
  className,
  showIcon = false,
  children,
  onClick,
}: UserLinkProps) {
  const targetName = (name || username || "").trim();
  const content = children ?? (targetName || "Unknown");

  if (!targetName && !userId) {
    return (
      <span className={cn("truncate inline-flex items-center gap-1", className)}>
        {content}
      </span>
    );
  }

  // Construct target link: prefer explicit userId, then username, then name
  const href = userId
    ? `/dashboard/profile?id=${userId}`
    : `/dashboard/profile?username=${encodeURIComponent(username || targetName)}`;

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.stopPropagation();
    onClick?.();
  };

  return (
    <Link
      href={href}
      onClick={handleClick}
      className={cn(
        "inline-flex items-center gap-1 text-primary hover:underline font-medium transition-colors cursor-pointer",
        className
      )}
      title={`View ${targetName}'s profile`}
    >
      {showIcon && (
        <svg
          className="h-3 w-3 shrink-0 opacity-70"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      )}
      <span className="truncate">{content}</span>
    </Link>
  );
}
