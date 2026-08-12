import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { Role } from "@/lib/types"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const roleBadgeClass: Record<Role, string> = {
  admin:    "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300",
  verified: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400",
  viewer:   "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
}
