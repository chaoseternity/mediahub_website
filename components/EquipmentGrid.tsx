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
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/equipment");
    const data: Equipment[] = await res.json();
    setItems(data);
  }, []);

  // Derive filter options
  const tags = Array.from(new Set(items.flatMap((i) => i.tags))).sort();
  const statuses = ["Available", "Checked Out", "Under Maintenance", "Retired"];

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    const matchSearch =
      item.name.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));
    const matchTag = tagFilter === ALL || item.tags.includes(tagFilter);
    const matchStatus = statusFilter === ALL || item.status === statusFilter;
    return matchSearch && matchTag && matchStatus;
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
          placeholder="Search by name, location or tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs"
        />
        <Select value={tagFilter} onValueChange={(v) => setTagFilter(v ?? ALL)}>
          <SelectTrigger className="w-full sm:w-44">
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
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? ALL)}>
          <SelectTrigger className="w-full sm:w-44">
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
        {role === "admin" && onAddNew && (
          <Button onClick={onAddNew} className="w-full sm:w-auto sm:ml-auto">
            + Add Equipment
          </Button>
        )}
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">No equipment found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((item) => (
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
