"use client";

import { useState, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LayoutGrid, Calendar, Tag, QrCode, Users as UsersIcon, Moon, Sun, LogOut, ChevronLeft, ChevronRight, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, roleBadgeClass } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface SidebarProps {
  userName: string;
  role: Role;
}

const allNavItems = [
  { href: "/dashboard",        label: "Equipment", icon: LayoutGrid,  roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/events", label: "Events",    icon: Calendar,    roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/sop",    label: "SOP & AI",  icon: Bot,         roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/tags",   label: "Tags",      icon: Tag,          roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/scan",   label: "Scan QR",   icon: QrCode,       roles: ["admin", "verified"] as Role[] },
  { href: "/dashboard/users",  label: "Users",     icon: UsersIcon,    roles: ["admin"] as Role[] },
];

const STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({ userName, role }: SidebarProps) {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [collapsed, setCollapsed] = useState(false);
  const navItems = allNavItems.filter((item) => item.roles.includes(role));

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

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col border-r bg-background h-full shrink-0 transition-[width] duration-200 overflow-hidden relative",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Collapse / expand toggle — tall rectangle flush with the right edge, vertically centred */}
      <Button
        variant="ghost"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        onClick={toggle}
        className="absolute right-0 top-1/2 -translate-y-1/2 z-20 h-16 w-5 rounded-l-md rounded-r-none border-l border-y bg-muted/60 hover:bg-muted flex items-center justify-center p-0"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      {/* Logo */}
      <div className="flex items-center px-4 py-4 border-b min-w-0">
        {!collapsed && (
          <h1 className="font-bold text-lg tracking-tight truncate">MediaHub</h1>
        )}
      </div>

      {/* Nav with larger text and icons */}
      <nav className="flex-1 px-2.5 py-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-base transition-colors",
              collapsed && "justify-center px-2 py-2.5",
              pathname === href
                ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent font-medium"
            )}
          >
            <Icon className="h-5 w-5 shrink-0" />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        ))}
      </nav>

      {/* User info + actions */}
      <div className={cn("py-3.5 border-t space-y-2.5", collapsed ? "px-1.5" : "px-3.5")}>
        {!collapsed && (
          <div className="flex items-center gap-2 px-1">
            <span className="text-sm font-semibold truncate flex-1 min-w-0">{userName}</span>
            <Badge className={cn(roleBadgeClass[role], "shrink-0")}>
              {role}
            </Badge>
          </div>
        )}
        <div className={cn("flex gap-1.5", collapsed && "flex-col items-center")}>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle dark mode"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="h-9 w-9"
          >
            {mounted &&
              (resolvedTheme === "dark" ? (
                <Sun className="h-5 w-5" />
              ) : (
                <Moon className="h-5 w-5" />
              ))}
          </Button>
          <Button
            variant="outline"
            size={collapsed ? "icon" : "sm"}
            aria-label="Sign out"
            title="Sign out"
            className={cn("h-9", !collapsed && "flex-1 justify-start gap-2 text-sm font-medium")}
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4.5 w-4.5" />
            {!collapsed && "Sign Out"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
