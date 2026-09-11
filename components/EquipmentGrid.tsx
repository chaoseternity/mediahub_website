"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EquipmentCard } from "@/components/EquipmentCard";
import { EquipmentModal } from "@/components/EquipmentModal";
import { parseEquipmentId, sortEquipmentById, getAdaptiveBarcodeWidth } from "@/lib/utils";
import type { Equipment, Role } from "@/lib/types";
import { Barcode, Loader2 } from "lucide-react";
import JSZip from "jszip";
import JsBarcode from "jsbarcode";

interface EquipmentGridProps {
  initialData: Equipment[];
  role: Role;
  onAddNew?: () => void;
  userName?: string;
  onRefresh?: () => void;
}

const ALL = "all";

export function EquipmentGrid({ initialData, role, onAddNew: _onAddNew, userName, onRefresh }: EquipmentGridProps) {
  const [items, setItems] = useState<Equipment[]>(initialData);

  useEffect(() => {
    setItems(initialData);
  }, [initialData]);
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);
  
  // Cascading Equipment ID variable filters (up to 4 variables: <a>-<b>-<c>-<d>)
  const [idVar1, setIdVar1] = useState(ALL);
  const [idVar2, setIdVar2] = useState(ALL);
  const [idVar3, setIdVar3] = useState(ALL);
  const [idVar4, setIdVar4] = useState(ALL);

  const [sortBy, setSortBy] = useState<"updated" | "id_asc" | "name_asc" | "status">("updated");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/equipment");
    const data: Equipment[] = await res.json();
    setItems(data);
    onRefresh?.();
  }, [onRefresh]);

  // Derive filter options
  const tags = Array.from(new Set(items.flatMap((i) => i.tags))).sort();
  const statuses = [
    "Available",
    "Checked Out",
    "In Event",
    "In Event (Rehearsal)",
    "Unavailable (In Repairs)",
    "Unavailable (Broken)",
    "Unavailable (Missing)",
    "Unavailable (Retired)",
  ];

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
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

  // 4. Derive available Variable 4 <d> options under selected Variable 1, Variable 2, and Variable 3
  const var4Options = Array.from(
    new Set(
      items
        .map((i) => parseEquipmentId(i.serial_number))
        .filter((p) => idVar1 !== ALL && idVar2 !== ALL && idVar3 !== ALL && p.partA === idVar1 && p.partB === idVar2 && p.partC === idVar3 && p.partD)
        .map((p) => p.partD)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));

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
      parsedId.partD.toLowerCase().includes(q) ||
      item.location.toLowerCase().includes(q) ||
      item.tags.some((t) => t.toLowerCase().includes(q));

    const matchTag = tagFilter === ALL || item.tags.includes(tagFilter);
    const matchStatus = statusFilter === ALL || item.status === statusFilter;

    // Cascading Equipment ID matches
    const matchVar1 = idVar1 === ALL || parsedId.partA === idVar1;
    const matchVar2 = idVar2 === ALL || parsedId.partB === idVar2;
    const matchVar3 = idVar3 === ALL || parsedId.partC === idVar3;
    const matchVar4 = idVar4 === ALL || parsedId.partD === idVar4;

    return matchSearch && matchTag && matchStatus && matchVar1 && matchVar2 && matchVar3 && matchVar4;
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
    setIdVar4(ALL);
  }

  function handleVar2Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar2(val);
    setIdVar3(ALL);
    setIdVar4(ALL);
  }

  function handleVar3Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar3(val);
    setIdVar4(ALL);
  }

  function handleVar4Change(v: string | null) {
    const val = v ?? ALL;
    setIdVar4(val);
  }

  const [isDownloadingBarcodes, setIsDownloadingBarcodes] = useState(false);

  async function handleDownloadAllBarcodes() {
    if (items.length === 0) return;
    try {
      setIsDownloadingBarcodes(true);
      const zip = new JSZip();
      const folder = zip.folder("barcodes");

      // Generate a barcode PNG for each equipment item
      for (const eq of items) {
        const codeValue = eq.serial_number?.trim() || (eq.id ? `EQ-${eq.id}` : eq.name?.trim() || "EQUIPMENT");
        // Sanitize filename
        const safeName = (eq.serial_number?.trim() || `equipment_${eq.id}`)
          .replace(/[/\\?%*:|"<>]/g, "-");
        const filename = `${safeName}.png`;

        const adaptiveWidth = getAdaptiveBarcodeWidth(codeValue, 280);

        const canvas = document.createElement("canvas");
        try {
          JsBarcode(canvas, codeValue, {
            format: "CODE128",
            width: adaptiveWidth,
            height: 60,
            displayValue: true,
            fontSize: 14,
            font: "monospace",
            textMargin: 4,
            margin: 10,
            background: "#ffffff",
            lineColor: "#000000",
          });
        } catch {
          // Fallback if codeValue contains special characters not supported by CODE128
          const fallbackVal = codeValue.replace(/[^a-zA-Z0-9_-]/g, "") || `EQ-${eq.id}`;
          const fallbackAdaptiveWidth = getAdaptiveBarcodeWidth(fallbackVal, 280);
          JsBarcode(canvas, fallbackVal, {
            format: "CODE128",
            width: fallbackAdaptiveWidth,
            height: 60,
            displayValue: true,
            fontSize: 14,
            font: "monospace",
            textMargin: 4,
            margin: 10,
            background: "#ffffff",
            lineColor: "#000000",
          });
        }

        const dataUrl = canvas.toDataURL("image/png");
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
        folder?.file(filename, base64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      const today = new Date().toISOString().split("T")[0];
      a.download = `Equipment_Barcodes_${today}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate and download barcodes zip:", err);
      alert("Failed to generate barcodes. Please try again.");
    } finally {
      setIsDownloadingBarcodes(false);
    }
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

        {/* Compact Inline Cascading Equipment ID Filter */}
        <div className="inline-flex items-center gap-1 bg-muted/30 border rounded-lg px-2.5 py-1 text-xs">
          <span className="font-semibold text-muted-foreground shrink-0 select-none">ID:</span>

          {/* Variable 1 dropdown */}
          <Select value={idVar1} onValueChange={handleVar1Change}>
            <SelectTrigger className="h-7 w-20 px-2 py-0 text-xs font-mono font-medium border-muted-foreground/30 bg-background">
              <SelectValue>{idVar1 === ALL ? "All" : idVar1}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All</SelectItem>
              {var1Options.map((p) => (
                <SelectItem key={p} value={p} className="font-mono text-xs">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Variable 2 dropdown (opens when <a> is selected) */}
          {idVar1 !== ALL && var2Options.length > 0 && (
            <>
              <span className="text-muted-foreground font-bold select-none">-</span>
              <Select value={idVar2} onValueChange={handleVar2Change}>
                <SelectTrigger className="h-7 w-20 px-2 py-0 text-xs font-mono font-medium border-primary/40 bg-primary/5 text-primary">
                  <SelectValue>{idVar2 === ALL ? "All" : idVar2}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {var2Options.map((v2) => (
                    <SelectItem key={v2} value={v2} className="font-mono text-xs">
                      {v2}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          {/* Variable 3 dropdown (opens when <b> is selected and <c> exists) */}
          {idVar1 !== ALL && idVar2 !== ALL && var3Options.length > 0 && (
            <>
              <span className="text-muted-foreground font-bold select-none">-</span>
              <Select value={idVar3} onValueChange={handleVar3Change}>
                <SelectTrigger className="h-7 w-20 px-2 py-0 text-xs font-mono font-medium border-primary/40 bg-primary/5 text-primary">
                  <SelectValue>{idVar3 === ALL ? "All" : idVar3}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {var3Options.map((v3) => (
                    <SelectItem key={v3} value={v3} className="font-mono text-xs">
                      {v3}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}

          {/* Variable 4 dropdown (opens when <c> is selected and <d> exists) */}
          {idVar1 !== ALL && idVar2 !== ALL && idVar3 !== ALL && var4Options.length > 0 && (
            <>
              <span className="text-muted-foreground font-bold select-none">-</span>
              <Select value={idVar4} onValueChange={handleVar4Change}>
                <SelectTrigger className="h-7 w-20 px-2 py-0 text-xs font-mono font-medium border-primary/40 bg-primary/5 text-primary">
                  <SelectValue>{idVar4 === ALL ? "All" : idVar4}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {var4Options.map((v4) => (
                    <SelectItem key={v4} value={v4} className="font-mono text-xs">
                      {v4}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </div>

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

        {/* Download All Barcodes button beside Sort */}
        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadAllBarcodes}
          disabled={isDownloadingBarcodes || items.length === 0}
          title="Download all equipment barcodes as a ZIP file"
          className="gap-1.5"
        >
          {isDownloadingBarcodes ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Exporting…</span>
            </>
          ) : (
            <>
              <Barcode className="h-4 w-4" />
              <span>Download Barcodes</span>
            </>
          )}
        </Button>
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
