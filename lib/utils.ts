import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Role } from "@/lib/types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const roleBadgeClass: Record<Role, string> = {
  admin:    "bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-300",
  verified: "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/40 dark:text-green-400",
  viewer:   "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300",
};

export interface ParsedEquipmentId {
  partA: string;
  partB: string;
  partC: string;
  prefix: string;
  subPrefix: string;
  formatted: string;
}

export function parseEquipmentId(idString: string | null | undefined): ParsedEquipmentId {
  if (!idString || !idString.trim()) {
    return { partA: "UNASSIGNED", partB: "", partC: "", prefix: "UNASSIGNED", subPrefix: "UNASSIGNED", formatted: "N/A" };
  }

  const parts = idString.trim().split("-").map((p) => p.trim());
  const partA = parts[0] ? parts[0].toUpperCase() : "";
  const partB = parts[1] ? parts[1].toUpperCase() : "";
  const partC = parts.slice(2).join("-").toUpperCase();

  const prefix = partA || "UNASSIGNED";
  const subPrefix = partB ? `${partA}-${partB}` : prefix;

  const formattedParts = [partA, partB, partC].filter(Boolean);
  const formatted = formattedParts.join("-");

  return {
    partA,
    partB,
    partC,
    prefix,
    subPrefix,
    formatted,
  };
}

export function sortEquipmentById(a: { serial_number: string | null }, b: { serial_number: string | null }): number {
  const pA = parseEquipmentId(a.serial_number);
  const pB = parseEquipmentId(b.serial_number);

  // 1. Compare <a> (partA)
  const cmpA = pA.partA.localeCompare(pB.partA, undefined, { numeric: true, sensitivity: "base" });
  if (cmpA !== 0) return cmpA;

  // 2. Compare <b> (partB)
  const cmpB = pA.partB.localeCompare(pB.partB, undefined, { numeric: true, sensitivity: "base" });
  if (cmpB !== 0) return cmpB;

  // 3. Compare <c> (partC)
  return pA.partC.localeCompare(pB.partC, undefined, { numeric: true, sensitivity: "base" });
}
