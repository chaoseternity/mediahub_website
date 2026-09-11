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
import {
  Upload,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

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
  const [confirmDeleteMissing, setConfirmDeleteMissing] = useState(false);
  const [showMissingList, setShowMissingList] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFile(null);
    setParsedItems([]);
    setParseError(null);
    setIsSubmitting(false);
    setConfirmDeleteMissing(false);
    setShowMissingList(false);
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
    setConfirmDeleteMissing(false);
    setShowMissingList(false);

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

  const missingEquipment = existingEquipment.filter((eq) => !matchedExistingIds.has(eq.id));

  async function handleUpload() {
    if (parsedItems.length === 0 || isSubmitting) return;

    if (confirmDeleteMissing && missingEquipment.length > 0) {
      const activeCount = missingEquipment.filter(
        (eq) => eq.active_checkout_id !== null || eq.status === "Checked Out"
      ).length;
      let confirmMsg = `⚠️ WARNING: You have selected to delete ${missingEquipment.length} equipment item(s) from your database that do not appear in the uploaded Excel file.\n\nAre you sure you want to permanently delete these items? This action cannot be undone.`;
      if (activeCount > 0) {
        confirmMsg += `\n\n(${activeCount} item(s) with active checkouts will be preserved and skipped).`;
      }
      const ok = window.confirm(confirmMsg);
      if (!ok) return;
    }

    setIsSubmitting(true);
    setParseError(null);

    try {
      const res = await fetch("/api/equipment/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: parsedItems,
          deleteMissingIds:
            confirmDeleteMissing && missingEquipment.length > 0
              ? missingEquipment.map((eq) => eq.id)
              : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to upload equipment batch");
      }

      let msg = `Successfully processed: ${data.createdCount} newly created (Available), ${data.updatedCount} updated (status preserved).`;
      if (data.deletedCount && data.deletedCount > 0) {
        msg += ` ${data.deletedCount} missing equipment deleted.`;
      }
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
                {missingEquipment.length > 0 && (
                  <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">
                    {missingEquipment.length} Missing from Excel
                  </Badge>
                )}
                <p className="text-xs text-muted-foreground w-full pt-1 border-t mt-1">
                  {confirmDeleteMissing && missingEquipment.length > 0 ? (
                    <>
                      Ready to sync! Click{" "}
                      <strong>
                        &quot;Confirm & Apply (Delete {missingEquipment.length} missing)&quot;
                      </strong>{" "}
                      below to update equipment and delete missing items.
                    </>
                  ) : (
                    <>
                      Ready to upload! Click{" "}
                      <strong>&quot;Confirm & Apply ({parsedItems.length})&quot;</strong> at the
                      bottom right to apply these changes to your database.
                    </>
                  )}
                </p>
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

              {/* Missing Equipment & Deletion Section */}
              {missingEquipment.length > 0 && (
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3.5 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <h4 className="text-sm font-semibold text-foreground">
                        Missing Equipment Detected ({missingEquipment.length})
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {missingEquipment.length} item{missingEquipment.length === 1 ? "" : "s"}{" "}
                        currently in your database do not appear in this Excel spreadsheet.
                      </p>
                    </div>
                  </div>

                  <label className="flex items-start gap-2.5 p-2.5 rounded-md border border-destructive/30 bg-background cursor-pointer hover:bg-muted/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={confirmDeleteMissing}
                      onChange={(e) => setConfirmDeleteMissing(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-destructive text-destructive focus:ring-destructive cursor-pointer"
                    />
                    <div className="text-xs space-y-0.5">
                      <span className="font-semibold text-destructive flex items-center gap-1.5">
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete missing equipment from database ({missingEquipment.length} item
                        {missingEquipment.length === 1 ? "" : "s"})
                      </span>
                      <p className="text-muted-foreground text-[11px]">
                        Checked out equipment will be safely skipped. Requires confirmation before
                        proceeding.
                      </p>
                    </div>
                  </label>

                  <div>
                    <button
                      type="button"
                      onClick={() => setShowMissingList((prev) => !prev)}
                      className="text-xs text-primary font-medium hover:underline flex items-center gap-1"
                    >
                      {showMissingList ? (
                        <>
                          <ChevronUp className="h-3.5 w-3.5" />
                          Hide missing equipment list
                        </>
                      ) : (
                        <>
                          <ChevronDown className="h-3.5 w-3.5" />
                          View {missingEquipment.length} missing equipment item
                          {missingEquipment.length === 1 ? "" : "s"}
                        </>
                      )}
                    </button>

                    {showMissingList && (
                      <div className="mt-2 border rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-background">
                        <table className="w-full text-xs text-left">
                          <thead className="bg-muted/70 sticky top-0 border-b font-medium text-muted-foreground">
                            <tr>
                              <th className="p-2">ID</th>
                              <th className="p-2">Name</th>
                              <th className="p-2">Condition</th>
                              <th className="p-2">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {missingEquipment.map((eq) => {
                              const isCheckedOut =
                                eq.active_checkout_id !== null || eq.status === "Checked Out";
                              return (
                                <tr key={eq.id} className="hover:bg-muted/20">
                                  <td className="p-2 font-mono">{eq.serial_number || "—"}</td>
                                  <td className="p-2 font-medium">{eq.name}</td>
                                  <td className="p-2">{eq.condition}</td>
                                  <td className="p-2">
                                    {isCheckedOut ? (
                                      <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1">
                                        ⚠️ Checked Out (will skip)
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground">{eq.status}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
            variant={confirmDeleteMissing && missingEquipment.length > 0 ? "destructive" : "default"}
            className="gap-1.5"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Applying Changes…
              </>
            ) : confirmDeleteMissing && missingEquipment.length > 0 ? (
              <>
                <Trash2 className="h-4 w-4" />
                Confirm & Apply (Delete {missingEquipment.length} missing)
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
