"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import {
  LayoutGrid,
  Calendar,
  Tag,
  QrCode,
  Nfc,
  Users as UsersIcon,
  Moon,
  Sun,
  LogOut,
  ChevronLeft,
  Bot,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, roleBadgeClass } from "@/lib/utils";
import type { Role } from "@/lib/types";
import { Logo } from "@/components/Logo";

interface SidebarProps {
  userName: string;
  role: Role;
}

interface NavGroup {
  title: string;
  items: {
    href: string;
    label: string;
    icon: LucideIcon;
    roles: Role[];
  }[];
}

const navGroups: NavGroup[] = [
  {
    title: "Equipment & Events",
    items: [
      { href: "/dashboard", label: "Equipment", icon: LayoutGrid, roles: ["admin", "verified", "viewer"] },
      { href: "/dashboard/events", label: "Events", icon: Calendar, roles: ["admin", "verified", "viewer"] },
      { href: "/dashboard/scan", label: "Scan QR", icon: QrCode, roles: ["admin", "verified", "viewer"] },
      { href: "/dashboard/nfc", label: "NFC Station", icon: Nfc, roles: ["admin", "verified"] },
    ],
  },
  {
    title: "SOP & AI Assistant",
    items: [
      { href: "/dashboard/sop", label: "SOP & AI", icon: Bot, roles: ["admin", "verified", "viewer"] },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/dashboard/profile", label: "Profile", icon: UserIcon, roles: ["admin", "verified", "viewer"] },
    ],
  },
  {
    title: "Admin & Settings",
    items: [
      { href: "/dashboard/tags", label: "Tags", icon: Tag, roles: ["admin"] },
      { href: "/dashboard/users", label: "Users", icon: UsersIcon, roles: ["admin"] },
    ],
  },
];

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({ userName, role }: SidebarProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [collapsed, setCollapsed] = useState(false);

  // Restore preference after hydration to avoid SSR mismatch
  useEffect(() => {
    setCollapsed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "b" &&
        !["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement)?.tagName || "")
      ) {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Filter groups based on user role
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.roles.includes(role)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r border-border/70 bg-sidebar text-sidebar-foreground transition-[width] duration-300 ease-in-out relative shrink-0 select-none z-30",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Floating Circular Collapse / Expand Toggle Button */}
      <button
        type="button"
        aria-label={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
        title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
        onClick={toggle}
        className={cn(
          "absolute -right-3.5 top-5 z-40 h-7 w-7 rounded-full border border-border/80 bg-background shadow-xs hover:shadow-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        <ChevronLeft
          className={cn(
            "h-4 w-4 transition-transform duration-300 ease-in-out",
            collapsed && "rotate-180"
          )}
        />
      </button>

      {/* Header & Logo */}
      <div className="flex items-center h-16 px-3.5 border-b border-border/70 min-w-0 overflow-hidden">
        <Link href="/dashboard" className="flex items-center min-w-0 group">
          <div className="shrink-0 flex items-center justify-center">
            <Logo size="md" iconOnly />
          </div>
          <div
            className={cn(
              "flex flex-col justify-center overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
              collapsed
                ? "max-w-0 opacity-0 -translate-x-3 pointer-events-none ml-0"
                : "max-w-[140px] opacity-100 translate-x-0 ml-2.5"
            )}
          >
            <span className="font-extrabold tracking-tight truncate flex items-center gap-0.5 text-foreground leading-tight text-lg">
              <span>Media</span>
              <span>Hub</span>
            </span>
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground truncate">
              Media Club
            </span>
          </div>
        </Link>
      </div>

      {/* Grouped Navigation */}
      <nav className="flex-1 px-2.5 py-3.5 space-y-4 overflow-y-auto overflow-x-hidden">
        {visibleGroups.map((group, groupIdx) => (
          <div key={group.title} className="space-y-1">
            {/* Section Header or Divider */}
            <div className="relative flex items-center px-2 pt-1 pb-1 min-h-[22px] min-w-0">
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 transition-all duration-300 ease-in-out whitespace-nowrap truncate",
                  collapsed
                    ? "max-w-0 opacity-0 -translate-x-2 pointer-events-none overflow-hidden"
                    : "max-w-[160px] opacity-100 translate-x-0"
                )}
              >
                {group.title}
              </span>
              {collapsed && groupIdx > 0 && (
                <div className="w-8 mx-auto border-t border-border/60 transition-opacity duration-300" />
              )}
            </div>

            {/* Nav Items */}
            {group.items.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "group relative flex items-center h-9.5 rounded-lg text-sm font-medium transition-colors duration-150",
                    collapsed ? "justify-center px-0 w-10 mx-auto" : "px-3 gap-3 w-full",
                    isActive
                      ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/80"
                  )}
                >
                  <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                    <Icon className="h-4.5 w-4.5 shrink-0" />
                  </div>

                  <span
                    className={cn(
                      "truncate transition-all duration-300 ease-in-out whitespace-nowrap",
                      collapsed
                        ? "max-w-0 opacity-0 -translate-x-2 pointer-events-none overflow-hidden"
                        : "max-w-[150px] opacity-100 translate-x-0"
                    )}
                  >
                    {label}
                  </span>

                  {/* Fast Floating Tooltip in Collapsed Mode */}
                  {collapsed && (
                    <div
                      role="tooltip"
                      className="absolute left-full ml-3 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-semibold rounded-md shadow-md border border-border whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 z-50 flex items-center"
                    >
                      {label}
                    </div>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User profile & actions footer */}
      <div className="p-3 border-t border-border/70 bg-sidebar/50 backdrop-blur-xs flex flex-col gap-2.5 overflow-hidden">
        {/* User Card */}
        <Link
          href="/dashboard/profile"
          className={cn(
            "group relative flex items-center rounded-lg p-1.5 transition-colors hover:bg-accent/70 cursor-pointer min-w-0",
            collapsed ? "justify-center w-10 h-10 mx-auto" : "gap-2.5 w-full"
          )}
        >
          {/* Avatar Icon */}
          <div className="w-7 h-7 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center justify-center font-bold text-xs shrink-0 select-none uppercase group-hover:ring-2 group-hover:ring-primary/20 transition-all">
            {userName ? userName.charAt(0) : "U"}
          </div>

          {/* User Name & Role (Expanded) */}
          <div
            className={cn(
              "flex items-center justify-between min-w-0 flex-1 transition-all duration-300 ease-in-out overflow-hidden",
              collapsed
                ? "max-w-0 opacity-0 -translate-x-2 pointer-events-none"
                : "max-w-[150px] opacity-100 translate-x-0"
            )}
          >
            <span className="text-xs font-semibold truncate group-hover:text-primary transition-colors">
              {userName}
            </span>
            <Badge className={cn(roleBadgeClass[role], "shrink-0 ml-1 text-[10px] px-1.5 py-0")}>
              {role}
            </Badge>
          </div>

          {/* Tooltip on Collapsed Avatar */}
          {collapsed && (
            <div
              role="tooltip"
              className="absolute left-full ml-3 px-2.5 py-1 bg-popover text-popover-foreground text-xs font-semibold rounded-md shadow-md border border-border whitespace-nowrap pointer-events-none opacity-0 group-hover:opacity-100 translate-x-1 group-hover:translate-x-0 transition-all duration-150 z-50 flex items-center gap-1.5"
            >
              <span>{userName}</span>
              <span className="text-[10px] uppercase font-bold text-muted-foreground">({role})</span>
            </div>
          )}
        </Link>

        {/* Theme Toggle & Sign Out Actions */}
        <div className={cn("flex gap-1.5 items-center", collapsed ? "flex-col justify-center" : "w-full")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle dark mode"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="h-8.5 w-8.5 rounded-lg shrink-0 text-muted-foreground hover:text-foreground hover:bg-accent/80 transition-colors"
            title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {mounted &&
              (resolvedTheme === "dark" ? (
                <Sun className="h-4.5 w-4.5" />
              ) : (
                <Moon className="h-4.5 w-4.5" />
              ))}
          </Button>

          <Button
            variant="outline"
            size={collapsed ? "icon" : "sm"}
            aria-label="Sign out"
            title={collapsed ? "Sign Out" : undefined}
            className={cn(
              "h-8.5 rounded-lg font-medium transition-all duration-300 ease-in-out shrink-0",
              collapsed
                ? "w-8.5 p-0 justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40"
                : "flex-1 justify-start gap-2 text-xs px-2.5 text-muted-foreground hover:text-destructive hover:border-destructive/40"
            )}
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span
              className={cn(
                "truncate transition-all duration-300 ease-in-out whitespace-nowrap",
                collapsed
                  ? "max-w-0 opacity-0 -translate-x-2 pointer-events-none overflow-hidden"
                  : "max-w-[80px] opacity-100 translate-x-0"
              )}
            >
              Sign Out
            </span>
          </Button>
        </div>
      </div>
    </aside>
  );
}
