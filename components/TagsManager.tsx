"use client";

import React, { useState, useRef, useEffect } from "react";
import { Tag, Plus, Trash2, AlertCircle, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Tag as TagType, Equipment, Role } from "@/lib/types";

interface TagsManagerProps {
  initialTags: TagType[];
  initialEquipment: Equipment[];
  role: Role;
}

// ── Equipment search popover ──────────────────────────────────────────────────

function EquipmentSearch({
  tagId,
  alreadyTagged,
  allEquipment,
  onAdd,
}: {
  tagId: number;
  alreadyTagged: number[];
  allEquipment: Equipment[];
  onAdd: (item: Equipment) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const suggestions = allEquipment
    .filter((e) => !alreadyTagged.includes(e.id) && e.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 8);

  async function handleAdd(item: Equipment) {
    setAdding(true);
    setOpen(false);
    setQuery("");
    const res = await fetch(`/api/tags/${tagId}/equipment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equipmentId: item.id }),
    });
    if (res.ok) onAdd(item);
    setAdding(false);
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search equipment to add…"
          className="h-8 pl-7 text-xs"
          disabled={adding}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          {suggestions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              onMouseDown={(e) => { e.preventDefault(); handleAdd(item); }}
            >
              <span className="font-medium">{item.name}</span>
              <span className="ml-auto text-muted-foreground shrink-0">{item.location}</span>
            </button>
          ))}
        </div>
      )}
      {open && query.length > 0 && suggestions.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-md">
          <p className="px-3 py-2 text-xs text-muted-foreground">No matching equipment found.</p>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function TagsManager({ initialTags, initialEquipment, role }: TagsManagerProps) {
  const [tags, setTags] = useState<TagType[]>(initialTags);
  const [allEquipment, setAllEquipment] = useState<Equipment[]>(initialEquipment);
  const [newTagName, setNewTagName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const isAdmin = role === "admin";

  // Derive items-per-tag from allEquipment tags array
  function getItemsForTag(tagName: string) {
    return allEquipment.filter((e) => e.tags.includes(tagName));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTagName.trim() }),
    });
    if (res.ok) {
      const tag: TagType = await res.json();
      setTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTagName("");
    } else {
      const json = await res.json();
      setError(json.error ?? "Failed to create tag");
    }
    setCreating(false);
  }

  async function handleDeleteTag(id: number) {
    setError(null);
    const res = await fetch(`/api/tags/${id}`, { method: "DELETE" });
    if (res.ok) {
      setTags((prev) => prev.filter((t) => t.id !== id));
      setExpanded((prev) => { const s = new Set(prev); s.delete(id); return s; });
    } else {
      const json = await res.json();
      setError(json.error ?? "Failed to delete tag");
    }
  }

  async function handleRemoveItem(tagId: number, tagName: string, equipmentId: number) {
    const res = await fetch(`/api/tags/${tagId}/equipment/${equipmentId}`, { method: "DELETE" });
    if (res.ok) {
      setAllEquipment((prev) =>
        prev.map((e) =>
          e.id === equipmentId ? { ...e, tags: e.tags.filter((t) => t !== tagName) } : e
        )
      );
    }
  }

  function handleAddItem(tagName: string, item: Equipment) {
    setAllEquipment((prev) =>
      prev.map((e) =>
        e.id === item.id && !e.tags.includes(tagName) ? { ...e, tags: [...e.tags, tagName] } : e
      )
    );
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full max-w-5xl">
      <div className="mb-6">
        <h2 className="text-xl md:text-2xl font-bold">Tags</h2>
        <p className="text-muted-foreground text-sm">
          {tags.length} tag{tags.length !== 1 ? "s" : ""} — used to categorise equipment
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2 mb-4">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {isAdmin && (
        <form onSubmit={handleCreate} className="flex gap-2 mb-6">
          <Input
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            placeholder="New tag name…"
            className="max-w-xs"
          />
          <Button type="submit" disabled={creating || !newTagName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Add Tag
          </Button>
        </form>
      )}

      {tags.length === 0 ? (
        <Card>
          <CardContent className="py-10 flex flex-col items-center gap-2 text-muted-foreground">
            <Tag className="h-8 w-8 opacity-40" />
            <p className="text-sm">No tags yet. Add one above to get started.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {tags.map((tag) => {
            const items = getItemsForTag(tag.name);
            const isOpen = expanded.has(tag.id);
            return (
              <Card key={tag.id} className="overflow-visible">
                {/* ── Tag header row ── */}
                <div
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer select-none"
                  onClick={() => toggleExpand(tag.id)}
                >
                  {isOpen
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground">
                    <Tag className="h-3 w-3 shrink-0" />
                    {tag.name}
                  </span>
                  <Badge variant="secondary" className="text-xs">
                    {items.length} item{items.length !== 1 ? "s" : ""}
                  </Badge>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive ml-auto"
                      onClick={(e) => { e.stopPropagation(); handleDeleteTag(tag.id); }}
                      aria-label={`Delete tag ${tag.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                {/* ── Expanded panel ── */}
                {isOpen && (
                  <CardContent className="pt-4 pb-4 px-4 border-t overflow-visible">
                    {/* Equipment table */}
                    {items.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3">No equipment uses this tag yet.</p>
                    ) : (
                      <div className={`mb-3 grid ${isAdmin ? "grid-cols-[1fr_auto_auto_auto]" : "grid-cols-[1fr_auto_auto]"}`}>
                        {/* Header cells */}
                        <span className="text-xs font-medium text-muted-foreground pb-1 border-b pr-4">Name</span>
                        <span className="text-xs font-medium text-muted-foreground pb-1 border-b text-right px-4">Location</span>
                        <span className="text-xs font-medium text-muted-foreground pb-1 border-b text-right pl-4">Status</span>
                        {isAdmin && <span className="border-b pl-4" />}

                        {/* Data cells — all direct children of the same grid */}
                        {items.map((item) => (
                          <React.Fragment key={item.id}>
                            <span className="text-sm font-medium truncate flex items-center py-2 border-b pr-4">{item.name}</span>
                            <span className="text-xs text-muted-foreground text-right whitespace-nowrap flex items-center justify-end py-2 border-b px-4">{item.location}</span>
                            <span className="flex items-center justify-end py-2 border-b pl-4">
                              <Badge
                                variant={item.status === "Available" ? "default" : "secondary"}
                                className="text-xs"
                              >
                                {item.status}
                              </Badge>
                            </span>
                            {isAdmin && (
                              <span className="flex items-center justify-end py-2 border-b pl-4">
                                <button
                                  type="button"
                                  className="text-muted-foreground hover:text-destructive"
                                  onClick={() => handleRemoveItem(tag.id, tag.name, item.id)}
                                  aria-label={`Remove ${item.name} from tag ${tag.name}`}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}

                    {/* Add equipment search */}
                    {isAdmin && (
                      <EquipmentSearch
                        tagId={tag.id}
                        alreadyTagged={items.map((e) => e.id)}
                        allEquipment={allEquipment}
                        onAdd={(item) => handleAddItem(tag.name, item)}
                      />
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
