"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useTheme } from "next-themes";
import { LayoutGrid, Tag, QrCode, Users as UsersIcon, Moon, Sun, LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, roleBadgeClass } from "@/lib/utils";
import type { Role } from "@/lib/types";

interface MobileNavProps {
  userName: string;
  role: Role;
}

const allNavItems = [
  { href: "/dashboard",       label: "Equipment", icon: LayoutGrid,  roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/tags",  label: "Tags",      icon: Tag,          roles: ["admin", "verified", "viewer"] as Role[] },
  { href: "/dashboard/scan",  label: "Scan QR",   icon: QrCode,       roles: ["admin", "verified"] as Role[] },
  { href: "/dashboard/users", label: "Users",     icon: UsersIcon,    roles: ["admin"] as Role[] },
];

export function MobileNav({ userName, role }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const navItems = allNavItems.filter((item) => item.roles.includes(role));
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  return (
    <>
      {/* Top bar — mobile only */}
      <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-background sticky top-0 z-30">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          onClick={() => setOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="font-bold text-sm tracking-tight flex-1">Inventory Tracker</h1>
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Toggle dark mode"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </Button>
        )}
      </header>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-in drawer */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 bg-background border-r flex flex-col md:hidden transition-transform duration-200",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-4 py-4 border-b">
          <h1 className="font-bold text-base tracking-tight">Inventory Tracker</h1>
          <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                pathname === href
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3 border-t space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-sm font-medium truncate flex-1 min-w-0">{userName}</span>
            <Badge className={cn(roleBadgeClass[role], "shrink-0")}>
              {role}
            </Badge>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-1.5"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </Button>
        </div>
      </div>
    </>
  );
}
