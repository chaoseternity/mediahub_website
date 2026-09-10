"use client";

import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { TagMultiSelect } from "@/components/TagMultiSelect";
import type { Tag } from "@/lib/types";

const AddSchema = z.object({
  name: z.string().min(1),
  tags: z.array(z.string().min(1)).min(1, "Please select at least one tag"),
  description: z.string().optional(),
  serial_number: z.string().optional(),
  condition: z.enum(["Working", "Impaired", "Broken", "Missing"]),
  location: z.enum(["Media Room", "Showroom", "Control Room"]),
  status: z.enum(["Available", "Checked Out", "Unavailable (In Repairs)", "Unavailable (Broken)", "Unavailable (Missing)"]),
});

type AddFormValues = z.infer<typeof AddSchema>;

interface AddEquipmentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}

export function AddEquipmentModal({ open, onClose, onCreated }: AddEquipmentModalProps) {
  const [availableTags, setAvailableTags] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/tags")
      .then((r) => r.json())
      .then((data: Tag[]) => setAvailableTags(data.map((t) => t.name)));
  }, []);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<AddFormValues, unknown, AddFormValues>({
    resolver: zodResolver(AddSchema) as import("react-hook-form").Resolver<AddFormValues>,
    defaultValues: { condition: "Working", status: "Available", location: "Media Room", tags: [] },
  });

  const watchedTags = useWatch({ control, name: "tags" }) ?? [];
  const watchedCondition = useWatch({ control, name: "condition" }) ?? "Working";
  const watchedStatus = useWatch({ control, name: "status" }) ?? "Available";

  // When condition changes, automatically handle statuses
  const handleConditionChange = (c: AddFormValues["condition"]) => {
    setValue("condition", c, { shouldValidate: true, shouldDirty: true });
    if (c === "Missing") {
      setValue("status", "Unavailable (Missing)", { shouldValidate: true, shouldDirty: true });
    } else if (c === "Broken") {
      if (watchedStatus !== "Unavailable (In Repairs)") {
        setValue("status", "Unavailable (Broken)", { shouldValidate: true, shouldDirty: true });
      }
    } else if (watchedStatus === "Unavailable (Broken)" || watchedStatus === "Unavailable (Missing)") {
      setValue("status", "Available", { shouldValidate: true, shouldDirty: true });
    } else if (watchedStatus === "Unavailable (In Repairs)" && c === "Working") {
      setValue("status", "Available", { shouldValidate: true, shouldDirty: true });
    }
  };

  const handleStatusChange = (s: AddFormValues["status"]) => {
    setValue("status", s, { shouldValidate: true, shouldDirty: true });
    if (s === "Unavailable (Missing)") {
      setValue("condition", "Missing", { shouldValidate: true, shouldDirty: true });
    } else if (watchedCondition === "Missing") {
      setValue("condition", "Working", { shouldValidate: true, shouldDirty: true });
    }
  };

  // Determine allowed status options:
  // - If condition is Missing: only 'Unavailable (Missing)'
  // - If condition is Broken: 'Unavailable (Broken)', 'Unavailable (In Repairs)'
  // - If condition is Impaired: 'Available', 'Checked Out', 'Unavailable (In Repairs)', 'Unavailable (Missing)'
  // - If condition is Working: 'Available', 'Checked Out', 'Unavailable (Missing)'
  const statusOptions: AddFormValues["status"][] =
    watchedCondition === "Missing"
      ? ["Unavailable (Missing)"]
      : watchedCondition === "Broken"
      ? ["Unavailable (Broken)", "Unavailable (In Repairs)"]
      : watchedCondition === "Impaired"
      ? ["Available", "Checked Out", "Unavailable (In Repairs)", "Unavailable (Missing)"]
      : ["Available", "Checked Out", "Unavailable (Missing)"];

  async function onSubmit(data: AddFormValues) {
    const res = await fetch("/api/equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      reset({ condition: "Working", status: "Available", location: "Media Room", tags: [] });
      await onCreated();
      onClose();
    } else {
      const json = await res.json();
      alert(json.error ?? "Failed to create equipment");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto w-[95vw]">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">Add New Equipment</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 py-1">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-1">
              <Label htmlFor="new-name">Name *</Label>
              <Input id="new-name" {...register("name")} />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Tags *</Label>
              <TagMultiSelect
                value={watchedTags}
                onChange={(tags) => setValue("tags", tags, { shouldValidate: true })}
                available={availableTags}
                placeholder="Search tags…"
              />
              {errors.tags && <p className="text-xs text-destructive">{errors.tags.message}</p>}
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="new-desc">Description</Label>
              <Input id="new-desc" {...register("description")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-serial">Equipment ID</Label>
              <Input id="new-serial" placeholder="e.g. A-B-C-1" {...register("serial_number")} />
            </div>
            <div className="space-y-1">
              <Label>Condition *</Label>
              <Select value={watchedCondition} onValueChange={(v) => handleConditionChange(v as AddFormValues["condition"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Working", "Impaired", "Broken", "Missing"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Location *</Label>
              <Select defaultValue="Media Room" onValueChange={(v) => setValue("location", v as AddFormValues["location"])}>
                <SelectTrigger id="new-location"><SelectValue placeholder="Select location" /></SelectTrigger>
                <SelectContent>
                  {["Media Room", "Showroom", "Control Room"].map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.location && <p className="text-xs text-destructive">{errors.location.message}</p>}
            </div>
            <div className="space-y-1">
              <Label>Status *</Label>
              <Select
                value={watchedStatus}
                onValueChange={(v) => handleStatusChange(v as AddFormValues["status"])}
                disabled={watchedCondition === "Missing"}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {statusOptions.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting ? "Creating…" : "Create Equipment"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
