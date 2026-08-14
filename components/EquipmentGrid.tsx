"use client";

import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { EquipmentCard } from "@/components/EquipmentCard";
import { EquipmentModal } from "@/components/EquipmentModal";
import { parseEquipmentId, sortEquipmentById } from "@/lib/utils";
import type { Equipment, Role } from "@/lib/types";

interface EquipmentGridProps {
  initialData: Equipment[];
  role: Role;
  onAddNew?: () => void;
  userName?: string;
}

const ALL = "all";

export function EquipmentGrid({ initialData, role, onAddNew, userName }: EquipmentGridProps) {
  const [items, setItems] = useState<Equipment[]>(initialData);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  
  // Cascading Equipment ID variable filters (up to 3 variables: <a>-<b>-<c>)
  const [idVar1, setIdVar1] = useState(ALL);
  const [idVar2, setIdVar2] = useState(ALL);
  const [idVar3, setIdVar3] = useState(ALL);

  const [sortBy, setSortBy] = useState<"updated" | "id_asc" | "name_asc" | "status">("updated");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/equipment");
    const data: Equipment[] = await res.json();
    setItems(data);
  }, []);

  // Derive filter options
  const tags = Array.from(new Set(items.flatMap((i) => i.tags))).sort();
  const statuses = ["Available", "Checked Out", "In Event", "In Event (Rehearsal)", "Under Maintenance", "Retired"];

  // 1. Derive available Variable 1 <a> options across all items
  const var1Options = Array.from(
    new Set(
      items
        .map((i) => parseEquipmentId(i.serial_number).partA)
        .filter((p) => p && p !== "UNASSIGNED")
    )
  ).sort();

  // 2. Derive available Variable 2 <b> options under selected Variable 1
  const var2Options = Array.from(
    new Set(
      items
        .map((i) => parseEquipmentId(i.serial_number))
        .filter((p) => idVar1 !== ALL && p.partA === idVar1 && p.partB)
        .map((p) => p.partB)
    )
  ).sort();

  // 3. Derive available Variable 3 <c> options under selected Variable 1 and Variable 2
  const var3Options = Array.from(
    new Set(
      items
        .map((i) => parseEquipmentId(i.serial_number))
        .filter((p) => idVar1 !== ALL && idVar2 !== ALL && p.partA === idVar1 && p.partB === idVar2 && p.partC)
        .map((p) => p.partC)
    )
  ).sort();

  // Filter items
  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const parsedId = parseEquipmentId(item.serial_number);

    const matchSearch =
      item.name.toLowerCase().includes(q) ||
      (item.serial_number && item.serial_number.toLowerCase().includes(q)) ||
      parsedId.partA.toLowerCase().includes(q) ||
      parsedId.partB.toLowerCase().includes(q) ||
      parsedId.partC.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));

    const matchTag = tagFilter === ALL || item.tags.includes(tagFilter);
    const matchStatus = statusFilter === ALL || item.status === statusFilter;

    // Cascading Equipment ID matches
    const matchVar1 = idVar1 === ALL || parsedId.partA === idVar1;
    const matchVar2 = idVar2 === ALL || parsedId.partB === idVar2;
    const matchVar3 = idVar3 === ALL || parsedId.partC === idVar3;

    return matchSearch && matchTag && matchStatus && matchVar1 && matchVar2 && matchVar3;
  });

  // Apply Sorting
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "id_asc") {
      return sortEquipmentById(a, b);
    }
    if (sortBy === "name_asc") {
      return a.name.localeCompare(b.name);
    }
    if (sortBy === "status") {
      return a.status.localeCompare(b.status);
    }
    // Default: updated
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  function openModal(id: number) {
    setSelectedId(id);
    setModalOpen(true);
  }

  function handleVar1Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar1(val);
    setIdVar2(ALL);
    setIdVar3(ALL);
  }

  function handleVar2Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar2(val);
    setIdVar3(ALL);
  }

  function handleVar3Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar3(val);
  }

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <Input
          placeholder="Search by ID, prefix, name, location or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs"
        />

        {/* Cascading Equipment ID Variable 1 <a> Filter */}
        <Select value={idVar1} onValueChange={handleVar1Change}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue>
              {idVar1 === ALL ? "All ID Types" : `ID: ${idVar1}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All ID Types</SelectItem>
            {var1Options.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Cascading Equipment ID Variable 2 <b> Filter (opens when <a> is selected) */}
        {idVar1 !== ALL && var2Options.length > 0 && (
          <Select value={idVar2} onValueChange={handleVar2Change}>
            <SelectTrigger className="w-full sm:w-36 border-primary/50 bg-primary/5">
              <SelectValue>
                {idVar2 === ALL ? `All ${idVar1}-*` : `${idVar1}-${idVar2}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All {idVar1}-*</SelectItem>
              {var2Options.map((v2) => (
                <SelectItem key={v2} value={v2}>
                  {idVar1}-{v2}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Cascading Equipment ID Variable 3 <c> Filter (opens when <b> is selected and <c> exists) */}
        {idVar1 !== ALL && idVar2 !== ALL && var3Options.length > 0 && (
          <Select value={idVar3} onValueChange={handleVar3Change}>
            <SelectTrigger className="w-full sm:w-40 border-primary/50 bg-primary/5">
              <SelectValue>
                {idVar3 === ALL ? `All ${idVar1}-${idVar2}-*` : `${idVar1}-${idVar2}-${idVar3}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All {idVar1}-${idVar2}-*</SelectItem>
              {var3Options.map((v3) => (
                <SelectItem key={v3} value={v3}>
                  {idVar1}-{idVar2}-{v3}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Tag Filter */}
        <Select value={tagFilter} onValueChange={(v) => setTagFilter(v ?? ALL)}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue>
              {tagFilter === ALL ? "All Tags" : tagFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Tags</SelectItem>
            {tags.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status Filter */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? ALL)}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue>
              {statusFilter === ALL ? "All Statuses" : statusFilter}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All Statuses</SelectItem>
            {statuses.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort By Selector */}
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue>
              {sortBy === "updated"
                ? "Sort: Recently Updated"
                : sortBy === "id_asc"
                ? "Sort: Equipment ID (Prefix)"
                : sortBy === "name_asc"
                ? "Sort: Name (A-Z)"
                : "Sort: Status"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Sort: Recently Updated</SelectItem>
            <SelectItem value="id_asc">Sort: Equipment ID (Prefix)</SelectItem>
            <SelectItem value="name_asc">Sort: Name (A-Z)</SelectItem>
            <SelectItem value="status">Sort: Status</SelectItem>
          </SelectContent>
        </Select>

        {role === "admin" && onAddNew && (
          <Button onClick={onAddNew} className="w-full sm:w-auto sm:ml-auto">
            + Add Equipment
          </Button>
        )}
      </div>

      {/* Grid */}
      {sorted.length === 0 ? (
        <p className="text-muted-foreground text-sm">No equipment found matching filters.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map((item) => (
            <EquipmentCard
              key={item.id}
              equipment={item}
              onClick={() => openModal(item.id)}
            />
          ))}
        </div>
      )}

      <EquipmentModal
        equipmentId={selectedId}
        open={modalOpen}
        role={role}
        userName={userName}
        onClose={() => setModalOpen(false)}
        onUpdated={refresh}
      />
    </div>
  );
}
