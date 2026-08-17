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
  purchase_date: z.string().optional(),
  condition: z.enum(["New", "Good", "Fair", "Poor"]),
  location: z.string().min(1),
  status: z.enum(["Available", "Checked Out", "Under Maintenance", "Retired"]),
});

type AddFormValues = z.infer<typeof AddSchema>;

interface AddEquipmentModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
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
    defaultValues: { condition: "Good", status: "Available", tags: [] },
  });

  const watchedTags = useWatch({ control, name: "tags" }) ?? [];

  async function onSubmit(data: AddFormValues) {
    const res = await fetch("/api/equipment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      reset();
      onCreated();
      onClose();
    } else {
      const json = await res.json();
      alert(json.error ?? "Failed to create equipment");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto w-[95vw]">
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
            <div className="space-y-1 col-span-2">
              <Label htmlFor="new-description">Description</Label>
              <Input id="new-description" {...register("description")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-serial">Equipment ID</Label>
              <Input id="new-serial" placeholder="e.g. EQ-001" {...register("serial_number")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-date">Purchase Date</Label>
              <Input id="new-date" type="date" {...register("purchase_date")} />
            </div>
            <div className="space-y-1">
              <Label>Condition *</Label>
              <Select defaultValue="Good" onValueChange={(v) => setValue("condition", v as AddFormValues["condition"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["New","Good","Fair","Poor"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="new-location">Location *</Label>
              <Input id="new-location" {...register("location")} />
              {errors.location && <p className="text-xs text-destructive">{errors.location.message}</p>}
            </div>
            <div className="space-y-1 col-span-2">
              <Label>Status *</Label>
              <Select defaultValue="Available" onValueChange={(v) => setValue("status", v as AddFormValues["status"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["Available","Checked Out","Under Maintenance","Retired"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
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
