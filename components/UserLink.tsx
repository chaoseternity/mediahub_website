"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";

interface UserLinkProps {
  name: string;
  username?: string | null;
  userId?: number | null;
  className?: string;
  showIcon?: boolean;
  children?: React.ReactNode;
}

export function UserLink({
  name,
  username,
  userId,
  className,
  showIcon = false,
  children,
}: UserLinkProps) {
  const { data: session } = useSession();

  const currentRole = session?.user?.role;
  const currentUserId = session?.user?.id;
  const currentUsername = session?.user?.username?.toLowerCase();
  const currentName = session?.user?.name?.toLowerCase();

  const targetName = name?.trim() || "Unknown";
  const targetLower = targetName.toLowerCase();
  const targetUsernameLower = username?.trim().toLowerCase();

  const isSelf =
    (userId && String(userId) === currentUserId) ||
    (targetUsernameLower && targetUsernameLower === currentUsername) ||
    targetLower === currentUsername ||
    targetLower === currentName;

  const isAdmin = currentRole === "admin";
  const canAccess = isAdmin || isSelf;

  const content = children ?? targetName;

  if (!canAccess) {
    return (
      <span
        className={cn("truncate inline-flex items-center gap-1", className)}
        title={targetName}
      >
        {content}
      </span>
    );
  }

  // Construct target link
  const href = isSelf
    ? "/dashboard/profile"
    : userId
    ? `/dashboard/profile?id=${userId}`
    : `/dashboard/profile?username=${encodeURIComponent(username || targetName)}`;

  return (
    <Link
      href={href}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        "inline-flex items-center gap-1 text-primary hover:underline font-medium transition-colors cursor-pointer",
        className
      )}
      title={isSelf ? "View your profile" : `View ${targetName}'s profile (Admin)`}
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
