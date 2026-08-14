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
  const [prefixFilter, setPrefixFilter] = useState(ALL);
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

  // Derive unique ID prefixes <a> (e.g. LP, SD, CAM)
  const prefixes = Array.from(
    new Set(
      items
        .map((i) => parseEquipmentId(i.serial_number).prefix)
        .filter((p) => p !== "UNASSIGNED")
    )
  ).sort();

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
    const matchPrefix = prefixFilter === ALL || parsedId.prefix === prefixFilter;

    return matchSearch && matchTag && matchStatus && matchPrefix;
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

  return (
    <div>
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 mb-6 items-center">
        <Input
          placeholder="Search by ID (a-b), prefix (a), name, location or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs"
        />

        {/* Prefix Filter */}
        <Select value={prefixFilter} onValueChange={(v) => setPrefixFilter(v ?? ALL)}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue>
              {prefixFilter === ALL ? "All ID Prefixes" : `Prefix: ${prefixFilter}`}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All ID Prefixes</SelectItem>
            {prefixes.map((p) => (
              <SelectItem key={p} value={p}>
                Prefix: {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
