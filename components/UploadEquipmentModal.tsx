"use client";

import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseEquipmentExcel, type ParsedEquipmentItem } from "@/lib/excel";
import type { Equipment } from "@/lib/types";
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface UploadEquipmentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  existingEquipment: Equipment[];
}

export function UploadEquipmentModal({
  open,
  onClose,
  onSuccess,
  existingEquipment,
}: UploadEquipmentModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedItems, setParsedItems] = useState<ParsedEquipmentItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFile(null);
    setParsedItems([]);
    setParseError(null);
    setIsSubmitting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handleClose() {
    if (isSubmitting) return;
    resetState();
    onClose();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setParseError(null);
    setFile(selectedFile);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const items = parseEquipmentExcel(buffer);
      if (items.length === 0) {
        setParseError("No valid equipment rows found in the uploaded file. Please check column headers.");
        setParsedItems([]);
      } else {
        setParsedItems(items);
      }
    } catch (err) {
      console.error("Excel parse error:", err);
      setParseError("Failed to parse Excel file. Please ensure it is a valid .xlsx or .xls file.");
      setParsedItems([]);
    }
  }

  // Calculate new vs existing items
  const matchedExistingIds = new Set<number>();
  let newCount = 0;
  let updateCount = 0;

  for (const item of parsedItems) {
    const serial = item.serial_number ? item.serial_number.trim().toLowerCase() : "";
    const name = item.name.trim().toLowerCase();

    const existing = existingEquipment.find((eq) => {
      if (serial && eq.serial_number && eq.serial_number.trim().toLowerCase() === serial) {
        return true;
      }
      if (!serial && eq.name.trim().toLowerCase() === name) {
        return true;
      }
      return false;
    });

    if (existing) {
      matchedExistingIds.add(existing.id);
      updateCount++;
    } else {
      newCount++;
    }
  }

  async function handleUpload() {
    if (parsedItems.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setParseError(null);

    try {
      const res = await fetch("/api/equipment/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: parsedItems }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to upload equipment batch");
      }

      const msg = `Successfully processed: ${data.createdCount} newly created (Available), ${data.updatedCount} updated (status preserved).`;
      if (data.errors && data.errors.length > 0) {
        alert(`${msg}\n\nNotices:\n${data.errors.join("\n")}`);
      } else {
        alert(msg);
      }

      resetState();
      onSuccess();
      onClose();
    } catch (err) {
      console.error("Upload error:", err);
      setParseError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Upload Equipment Excel File
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Upload an Excel spreadsheet formatted with columns:{" "}
            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-foreground">
              Tag | ID | Name | Description | Condition | Location
            </span>
            . If a tag cell is empty, it automatically inherits the tag from the row above.
          </p>

          {/* File input / dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border hover:border-primary/50 transition-colors rounded-xl p-6 text-center cursor-pointer bg-muted/20 hover:bg-muted/40"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls"
              onChange={handleFileChange}
              className="hidden"
            />
            <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm font-medium">
              {file ? file.name : "Click to select or drop an Excel spreadsheet (.xlsx, .xls)"}
            </p>
            {file && (
              <p className="text-xs text-muted-foreground mt-1">
                {(file.size / 1024).toFixed(1)} KB • Click to choose a different file
              </p>
            )}
          </div>

          {/* Parse error alert */}
          {parseError && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{parseError}</span>
            </div>
          )}

          {/* Analysis Summary */}
          {parsedItems.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 p-3 bg-muted/40 border rounded-lg text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                <span className="font-medium">{parsedItems.length} items parsed:</span>
                <Badge variant="outline" className="bg-green-50 text-green-800 border-green-200">
                  +{newCount} New (Available)
                </Badge>
                <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-200">
                  {updateCount} Existing to Update (Status Preserved)
                </Badge>
              </div>

              {/* Preview Table */}
              <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/70 sticky top-0 border-b font-medium text-muted-foreground">
                    <tr>
                      <th className="p-2">Tag</th>
                      <th className="p-2">ID</th>
                      <th className="p-2">Name</th>
                      <th className="p-2">Condition</th>
                      <th className="p-2">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {parsedItems.slice(0, 8).map((item, idx) => (
                      <tr key={idx} className="hover:bg-muted/20">
                        <td className="p-2 font-medium">{item.tags.join(", ") || "—"}</td>
                        <td className="p-2 font-mono">{item.serial_number || "—"}</td>
                        <td className="p-2">{item.name}</td>
                        <td className="p-2">{item.condition}</td>
                        <td className="p-2 text-muted-foreground">{item.location}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedItems.length > 8 && (
                  <p className="text-[11px] text-muted-foreground text-center py-1.5 bg-muted/30 border-t">
                    Showing 8 of {parsedItems.length} items…
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={parsedItems.length === 0 || isSubmitting}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying Changes…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Confirm & Apply ({parsedItems.length})
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
