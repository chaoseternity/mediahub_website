"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CheckoutForm } from "@/components/CheckoutForm";
import { TagMultiSelect } from "@/components/TagMultiSelect";
import { cn } from "@/lib/utils";
import type { EquipmentDetail, Role, Checkout, Tag } from "@/lib/types";

interface EquipmentModalProps {
  equipmentId: number | null;
  open: boolean;
  role: Role;
  userName?: string;
  onClose: () => void;
  onUpdated: () => void;
}

const EditSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1, "Please select at least one tag"),
  description: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  condition: z.enum(["New", "Good", "Fair", "Poor"]),
  quantity: z.coerce.number().int().positive(),
  location: z.string().min(1),
  status: z.enum(["Available", "Checked Out", "Under Maintenance", "Retired"]),
});

type EditFormValues = z.infer<typeof EditSchema>;

const SGT = "Asia/Singapore";

// SQLite datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" — no 'T', no 'Z'.
// new Date() treats space-separated strings as *local* time, so we must
// normalise to an unambiguous ISO 8601 UTC string before parsing.
function parseUTC(s: string): Date {
  if (!s.includes("T") && !s.endsWith("Z") && !s.includes("+")) {
    return new Date(s.replace(" ", "T") + "Z");
  }
  return new Date(s);
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseUTC(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: SGT });
}

function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = parseUTC(s);
  return isNaN(d.getTime())
    ? s
    : d.toLocaleString("en-GB", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: SGT,
      });
}

export function EquipmentModal({
  equipmentId,
  open,
  role,
  userName,
  onClose,
  onUpdated,
}: EquipmentModalProps) {
  const [equipment, setEquipment] = useState<EquipmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  const isAdmin = role === "admin";
  const canCheckout = true;
  const canEditAll = role === "admin";
  const canEditDescription = role === "admin" || role === "verified";

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditFormValues, unknown, EditFormValues>({
    resolver: zodResolver(EditSchema) as import("react-hook-form").Resolver<EditFormValues>,
  });

  const watched = useWatch({ control });

  useEffect(() => {
    if (!open || !equipmentId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setShowCheckout(false);
    setEditingField(null);
    Promise.all([
      fetch(`/api/equipment/${equipmentId}`).then((r) => r.json()),
      fetch("/api/tags").then((r) => r.json()),
    ])
      .then(([data, tagsData]: [EquipmentDetail, Tag[]]) => {
        setEquipment(data);
        setAvailableTags(tagsData.map((t) => t.name));
        reset({
          name: data.name,
          tags: data.tags,
          description: data.description ?? "",
          serial_number: data.serial_number ?? "",
          purchase_date: data.purchase_date ?? "",
          condition: data.condition,
          quantity: data.quantity,
          location: data.location,
          status: data.status,
        });
      })
      .finally(() => setLoading(false));
  }, [open, equipmentId, reset]);

  async function onSave(data: EditFormValues) {
    await fetch(`/api/equipment/${equipmentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onUpdated();
    onClose();
  }

  async function handleReturn() {
    await fetch(`/api/equipment/${equipmentId}/return`, { method: "POST" });
    onUpdated();
    onClose();
  }

  async function handleDelete() {
    if (!confirm("Delete this equipment item?")) return;
    const res = await fetch(`/api/equipment/${equipmentId}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json();
      alert(json.error ?? "Delete failed");
      return;
    }
    onUpdated();
    onClose();
  }

  // ── Inline field renderers ─────────────────────────────────────────────────

  function renderField(
    name: keyof EditFormValues,
    label: string,
    type: "text" | "number" | "date" = "text",
    colSpan?: "2"
  ) {
    const isEditing = editingField === name;
    const raw = watched[name];
    const displayVal =
      raw === undefined || raw === null || raw === ""
        ? "—"
        : type === "date"
        ? fmtDate(String(raw))
        : String(raw);
    const canEdit = canEditAll || (canEditDescription && name === "description");

    return (
      <div className={cn("space-y-0.5", colSpan === "2" && "col-span-2")}>
        <Label className="text-xs text-muted-foreground font-medium">{label}</Label>
        {isEditing ? (
          <Input
            type={type}
            autoFocus
            min={type === "number" ? 1 : undefined}
            {...register(name)}
            onBlur={() => setEditingField(null)}
          />
        ) : (
          <div
            role={canEdit ? "button" : undefined}
            tabIndex={canEdit ? 0 : undefined}
            onKeyDown={(e) => canEdit && e.key === "Enter" && setEditingField(name)}
            onClick={() => canEdit && setEditingField(name)}
            className={cn(
              "px-3 py-1.5 rounded-md text-sm min-h-9 flex items-center gap-2 border border-transparent",
              canEdit && "cursor-pointer hover:bg-accent hover:border-border group"
            )}
          >
            <span className={cn(!raw && "text-muted-foreground italic")}>{displayVal}</span>
            {canEdit && (
              <Pencil className="ml-auto h-3 w-3 opacity-0 group-hover:opacity-40 shrink-0" />
            )}
          </div>
        )}
        {errors[name] && (
          <p className="text-xs text-destructive">
            {(errors[name] as { message?: string })?.message}
          </p>
        )}
      </div>
    );
  }

  function renderSelectField(
    name: "condition" | "status",
    label: string,
    options: string[]
  ) {
    const val = watched[name];
    return (
      <div className="space-y-0.5">
        <Label className="text-xs text-muted-foreground font-medium">{label}</Label>
        {isAdmin ? (
          <Select
            value={String(val ?? "")}
            onValueChange={(v) =>
              setValue(name, v as EditFormValues[typeof name], { shouldDirty: true })
            }
          >
            <SelectTrigger className="border-transparent bg-transparent hover:bg-accent hover:border-border shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={o}>
                  {o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="px-3 py-1.5 text-sm min-h-9 flex items-center">{val || "—"}</div>
        )}
      </div>
    );
  }

  // ── Last 5 checkouts ──────────────────────────────────────────────────────

  const last5 = equipment
    ? [...equipment.checkouts]
        .sort(
          (a, b) =>
            new Date(b.checked_out_at).getTime() - new Date(a.checked_out_at).getTime()
        )
        .slice(0, 5)
    : [];

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {equipment?.name ?? "Equipment"}
            {equipment && (
              <Badge
                variant={equipment.status === "Available" ? "default" : "secondary"}
                className="text-xs font-normal"
              >
                {equipment.status}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground py-4">Loading…</p>}

        {!loading && equipment && (
          <>
            {/* ── Save form (wraps fields only — avoids nested <form> with CheckoutForm) ── */}
            <form id="equipment-edit-form" onSubmit={handleSubmit(onSave)}>
              <Tabs defaultValue="details">
                <TabsList className="mb-4">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="history">Checkout History</TabsTrigger>
                </TabsList>

                {/* ── Details tab ── */}
                <TabsContent value="details">
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    {renderField("name", "Name")}
                    <div className="space-y-0.5">
                      <Label className="text-xs text-muted-foreground font-medium">Tags</Label>
                      <TagMultiSelect
                        value={watched.tags ?? []}
                        onChange={(tags) => setValue("tags", tags, { shouldDirty: true })}
                        available={availableTags}
                        disabled={!isAdmin}
                      />
                      {errors.tags && (
                        <p className="text-xs text-destructive">{errors.tags.message}</p>
                      )}
                    </div>
                    {renderField("description", "Description", "text", "2")}
                    {renderField("serial_number", "Serial Number")}
                    {renderField("purchase_date", "Purchase Date", "date")}
                    {renderSelectField("condition", "Condition", [
                      "New",
                      "Good",
                      "Fair",
                      "Poor",
                    ])}
                    {renderField("quantity", "Quantity", "number")}
                    {renderField("location", "Home Location", "text", "2")}
                    {renderSelectField("status", "Status", [
                      "Available",
                      "Checked Out",
                      "Under Maintenance",
                      "Retired",
                    ])}
                  </div>
                </TabsContent>

                {/* ── Checkout History tab ── */}
                <TabsContent value="history">
                  {last5.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">
                      No checkout history yet.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {last5.map((ch: Checkout) => (
                        <div key={ch.id} className="border rounded-lg p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-sm">{ch.checked_out_by_name}</p>
                            <Badge
                              variant={ch.returned_at ? "secondary" : "default"}
                              className="text-xs"
                            >
                              {ch.returned_at ? "Returned" : "Active"}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div>
                              <p className="text-muted-foreground mb-0.5">Checked out</p>
                              <p>{fmtDateTime(ch.checked_out_at)}</p>
                            </div>
                            {ch.expected_return_at && (
                              <div>
                                <p className="text-muted-foreground mb-0.5">Expected return</p>
                                <p>{fmtDate(ch.expected_return_at)}</p>
                              </div>
                            )}
                            {ch.returned_at && (
                              <div>
                                <p className="text-muted-foreground mb-0.5">Returned</p>
                                <p>{fmtDateTime(ch.returned_at)}</p>
                              </div>
                            )}
                          </div>
                          {ch.notes && (
                            <p className="text-xs text-muted-foreground italic">{ch.notes}</p>
                          )}
                        </div>
                      ))}
                      {equipment.checkouts.length > 5 && (
                        <p className="text-xs text-muted-foreground text-center pt-1">
                          Showing latest 5 of {equipment.checkouts.length} checkouts
                        </p>
                      )}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </form>

            {/* ── Action bar: Save / Delete / Check Out — all on one line ── */}
            <div className="mt-4 pt-4 border-t">
              {showCheckout ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3
                      className="font-semibold text-sm"
                      data-testid="checkout-section-header"
                    >
                      Check Out This Item
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground h-7"
                      onClick={() => setShowCheckout(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                  <CheckoutForm
                    equipmentId={equipment.id}
                    defaultName={userName}
                    onSuccess={() => {
                      onUpdated();
                      onClose();
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {equipment.status === "Checked Out" && equipment.active_checkout && (
                    <p className="text-xs text-muted-foreground">
                      Currently checked out to{" "}
                      <span className="font-medium text-foreground">
                        {equipment.active_checkout.checked_out_by_name}
                      </span>
                      {" since "}
                      <span className="font-medium text-foreground">
                        {fmtDateTime(equipment.active_checkout.checked_out_at)}
                      </span>
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {(isAdmin || role === "verified") && (
                      <Button
                        type="submit"
                        form="equipment-edit-form"
                        disabled={isSubmitting || !isDirty}
                        data-testid="save-button"
                      >
                        {isSubmitting ? "Saving…" : "Save Changes"}
                      </Button>
                    )}
                    {isAdmin && (
                      <Button type="button" variant="destructive" onClick={handleDelete}>
                        Delete
                      </Button>
                    )}
                    <div className="ml-auto">
                      {equipment.status === "Checked Out" && canCheckout && (
                        <Button variant="outline" size="sm" onClick={handleReturn}>
                          Mark as Returned
                        </Button>
                      )}
                      {equipment.status === "Available" && canCheckout && (
                        <Button
                          className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-0 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60"
                          onClick={() => setShowCheckout(true)}
                          data-testid="checkout-button"
                        >
                          Check Out
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
