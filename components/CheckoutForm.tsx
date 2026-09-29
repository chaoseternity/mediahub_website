"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";

const CheckoutSchema = z.object({
  checked_out_by_name: z.string().min(1, "Name is required"),
  expected_return_at: z.string().optional(),
  notes: z.string().min(1, "Purpose is required"),
  checkout_location: z.string().optional(),
});

type CheckoutFormValues = z.infer<typeof CheckoutSchema>;

interface CheckoutFormProps {
  equipmentId: number;
  defaultName?: string;
  onSuccess: () => void;
}

export function CheckoutForm({ equipmentId, defaultName, onSuccess }: CheckoutFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(CheckoutSchema),
    defaultValues: { checked_out_by_name: defaultName ?? "" },
  });

  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(data: CheckoutFormValues) {
    setSubmitError(null);
    try {
      const res = await fetch(`/api/equipment/${equipmentId}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        setSubmitError(await readErrorMessage(res, "Checkout failed"));
        return;
      }
      reset();
      onSuccess();
    } catch (err) {
      setSubmitError(networkErrorMessage(err));
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
      <div className="space-y-1">
        <Label htmlFor="checked_out_by_name">Checked out by *</Label>
        <Input
          id="checked_out_by_name"
          placeholder="Full name"
          {...register("checked_out_by_name")}
        />
        {errors.checked_out_by_name && (
          <p className="text-xs text-destructive">{errors.checked_out_by_name.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="notes">Purpose *</Label>
        <Input id="notes" placeholder="Why is this being checked out?" {...register("notes")} />
        {errors.notes && (
          <p className="text-xs text-destructive">{errors.notes.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label htmlFor="expected_return_at">Expected return date <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input id="expected_return_at" type="date" {...register("expected_return_at")} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="checkout_location">Location <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input id="checkout_location" placeholder="Where will this be used?" {...register("checkout_location")} />
      </div>

      {submitError && (
        <p role="alert" className="text-sm text-destructive">
          {submitError}
        </p>
      )}

      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Checking out…" : "Check Out"}
      </Button>
    </form>
  );
}
