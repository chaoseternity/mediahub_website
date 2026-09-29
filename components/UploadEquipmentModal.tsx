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
import {
  parseEquipmentExcel,
  BATCH_CHUNK_SIZE,
  MAX_IMPORT_ROWS,
  type ParsedEquipmentItem,
} from "@/lib/excel";
import type { Equipment } from "@/lib/types";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";
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

/** One item the server could not create/update, normalised for display. */
interface FailedUploadItem {
  label: string;
  reason: string;
}

interface UploadSummary {
  created: number;
  updated: number;
  failed: FailedUploadItem[];
  retired: number;
  deleted: number;
  notices: string[];
  /** Items never sent because an earlier request failed outright. */
  notSent: number;
  /** Set when "delete missing" was requested but withheld because an earlier chunk failed. */
  deleteSkippedReason: string | null;
  /** Hard failure (non-2xx / network) that stopped the upload. */
  fatalError: string | null;
}

const fmtCount = (n: number) => n.toLocaleString("en-US");

function num(...values: unknown[]): number {
  for (const v of values) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

/** Normalise the server's `failed` entries (strings or objects) relative to the chunk offset. */
function normaliseFailed(raw: unknown, chunk: ParsedEquipmentItem[], offset: number): FailedUploadItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, i) => {
    if (typeof entry === "string") return { label: "Item", reason: entry };
    const e = (entry ?? {}) as Record<string, unknown>;
    const idx = typeof e.index === "number" ? e.index : null;
    const src = idx !== null ? chunk[idx] : undefined;
    const name = (typeof e.name === "string" && e.name) || src?.name;
    const serial = (typeof e.serial_number === "string" && e.serial_number) || src?.serial_number;
    const position = idx !== null ? `#${offset + idx + 1}` : "";
    const label =
      [position, name, serial ? `(${serial})` : ""].filter(Boolean).join(" ") || `Item ${offset + i + 1}`;
    const reason =
      (typeof e.error === "string" && e.error) ||
      (typeof e.reason === "string" && e.reason) ||
      (typeof e.message === "string" && e.message) ||
      "Failed";
    return { label, reason };
  });
}

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
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setFile(null);
    setParsedItems([]);
    setParseError(null);
    setIsSubmitting(false);
    setConfirmDeleteMissing(false);
    setShowMissingList(false);
    setProgress(null);
    setSummary(null);
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
    setSummary(null);
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
        if (items.length >= MAX_IMPORT_ROWS) {
          setParseError(
            `Only the first ${fmtCount(MAX_IMPORT_ROWS)} rows of this sheet were read. Split larger sheets into several files.`
          );
        }
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

    const deleteIds =
      confirmDeleteMissing && missingEquipment.length > 0 ? missingEquipment.map((eq) => eq.id) : [];
    if (deleteIds.length > BATCH_CHUNK_SIZE) {
      setParseError(
        `Too many missing items to delete in one sync (${fmtCount(deleteIds.length)}; the limit is ${fmtCount(
          BATCH_CHUNK_SIZE
        )}). Untick "Delete missing equipment" or remove items in smaller steps.`
      );
      return;
    }

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
    setSummary(null);

    // The API accepts at most BATCH_CHUNK_SIZE items per request, so send sequential chunks.
    const total = parsedItems.length;
    const chunks: ParsedEquipmentItem[][] = [];
    for (let i = 0; i < total; i += BATCH_CHUNK_SIZE) {
      chunks.push(parsedItems.slice(i, i + BATCH_CHUNK_SIZE));
    }

    const result: UploadSummary = {
      created: 0,
      updated: 0,
      failed: [],
      retired: 0,
      deleted: 0,
      notices: [],
      notSent: 0,
      deleteSkippedReason: null,
      fatalError: null,
    };
    let allChunksClean = true;
    let anyApplied = false;

    try {
      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];
        const offset = c * BATCH_CHUNK_SIZE;
        const isFinal = c === chunks.length - 1;
        setProgress(
          chunks.length > 1
            ? `Uploading ${fmtCount(offset + 1)}–${fmtCount(offset + chunk.length)} of ${fmtCount(total)}…`
            : `Uploading ${fmtCount(total)} item${total === 1 ? "" : "s"}…`
        );

        // Deleting "missing" items is only safe once every other row has been applied, so the
        // IDs ride on the final chunk and only when all previous chunks fully succeeded.
        const sendDeletes = isFinal && deleteIds.length > 0 && allChunksClean;
        if (isFinal && deleteIds.length > 0 && !allChunksClean) {
          result.deleteSkippedReason =
            "Missing equipment was NOT deleted because some rows failed to upload. Fix the failed rows and upload again.";
        }

        let res: Response;
        try {
          res = await fetch("/api/equipment/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: chunk,
              deleteMissingIds: sendDeletes ? deleteIds : undefined,
            }),
          });
        } catch (err) {
          result.fatalError = networkErrorMessage(err);
          result.notSent = total - offset;
          break;
        }

        if (!res.ok) {
          const msg = await readErrorMessage(res, "Failed to upload equipment batch");
          result.fatalError =
            chunks.length > 1
              ? `Items ${fmtCount(offset + 1)}–${fmtCount(offset + chunk.length)}: ${msg}`
              : msg;
          result.notSent = total - offset;
          break;
        }

        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        anyApplied = true;
        const failed = normaliseFailed(data.failed, chunk, offset);
        result.created += num(data.createdCount, data.created);
        result.updated += num(data.updatedCount, data.updated);
        result.retired += num(data.retiredCount);
        result.deleted += num(data.deletedCount);
        result.failed.push(...failed);
        if (Array.isArray(data.errors)) {
          result.notices.push(...data.errors.filter((e): e is string => typeof e === "string"));
        }
        const failedCount = Math.max(failed.length, num(data.failedCount));
        if (data.partial === true || failedCount > 0) allChunksClean = false;
      }

      if (result.fatalError && deleteIds.length > 0 && !result.deleteSkippedReason) {
        result.deleteSkippedReason = "Missing equipment was NOT deleted because the upload did not complete.";
      }

      setSummary(result);
      if (anyApplied) onSuccess();
    } catch (err) {
      console.error("Upload error:", err);
      setParseError(networkErrorMessage(err, "Upload failed"));
    } finally {
      setProgress(null);
      setIsSubmitting(false);
    }
  }

  const uploadFinished = summary !== null;
  const uploadClean =
    summary !== null && !summary.fatalError && summary.failed.length === 0 && !summary.deleteSkippedReason;

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

          {/* Upload progress */}
          {progress && (
            <div
              role="status"
              className="p-3 bg-muted/40 border rounded-lg text-sm flex items-center gap-2"
              data-testid="upload-progress"
            >
              <Loader2 className="h-4 w-4 animate-spin shrink-0" />
              <span>{progress}</span>
            </div>
          )}

          {/* Upload result */}
          {summary && (
            <div
              role={uploadClean ? "status" : "alert"}
              data-testid="upload-summary"
              className={
                uploadClean
                  ? "p-3 rounded-lg border border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200 text-sm space-y-2"
                  : "p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 text-sm space-y-2"
              }
            >
              <p className="font-semibold flex items-center gap-2">
                {uploadClean ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                )}
                {uploadClean
                  ? "Upload complete"
                  : summary.fatalError
                  ? "Upload stopped before finishing"
                  : "Upload finished with problems"}
              </p>
              <ul className="text-xs space-y-0.5 list-disc pl-5">
                <li>{fmtCount(summary.created)} newly created (Available)</li>
                <li>{fmtCount(summary.updated)} updated (status preserved)</li>
                {summary.failed.length > 0 && <li>{fmtCount(summary.failed.length)} failed</li>}
                {summary.notSent > 0 && <li>{fmtCount(summary.notSent)} not sent</li>}
                {summary.deleted > 0 && <li>{fmtCount(summary.deleted)} missing equipment deleted</li>}
                {summary.retired > 0 && (
                  <li>
                    {fmtCount(summary.retired)} missing equipment retired instead of deleted (they have
                    usage history)
                  </li>
                )}
              </ul>
              {summary.fatalError && <p className="text-xs font-medium text-destructive">{summary.fatalError}</p>}
              {summary.deleteSkippedReason && <p className="text-xs font-medium">{summary.deleteSkippedReason}</p>}
              {summary.failed.length > 0 && (
                <div className="max-h-40 overflow-y-auto rounded border bg-background text-foreground">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/70 sticky top-0 border-b text-muted-foreground">
                      <tr>
                        <th className="p-1.5">Item</th>
                        <th className="p-1.5">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {summary.failed.map((f, i) => (
                        <tr key={i}>
                          <td className="p-1.5 font-medium">{f.label}</td>
                          <td className="p-1.5 text-destructive">{f.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {summary.notices.length > 0 && (
                <details className="text-xs">
                  <summary className="cursor-pointer font-medium">Notices ({summary.notices.length})</summary>
                  <ul className="mt-1 list-disc pl-5 space-y-0.5">
                    {summary.notices.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {/* Analysis Summary */}
          {parsedItems.length > 0 && !uploadFinished && (
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
            {uploadFinished ? "Close" : "Cancel"}
          </Button>
          {!uploadFinished && (
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
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
