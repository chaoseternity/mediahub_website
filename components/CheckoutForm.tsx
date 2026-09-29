"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState, useEffect } from "react";
import { readErrorMessage, networkErrorMessage } from "@/lib/fetch-error";
import { fetchUserDirectory, type DirectoryUser } from "@/lib/user-directory";
import type { Role } from "@/lib/types";

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
  role?: Role;
  onSuccess: () => void;
}

export function CheckoutForm({ equipmentId, defaultName, role, onSuccess }: CheckoutFormProps) {
  const isAdmin = role === "admin";
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    setValue,
  } = useForm<CheckoutFormValues>({
    resolver: zodResolver(CheckoutSchema),
    defaultValues: { checked_out_by_name: defaultName ?? "" },
  });

  useEffect(() => {
    if (defaultName) {
      setValue("checked_out_by_name", defaultName);
    }
  }, [defaultName, setValue]);

  useEffect(() => {
    if (!isAdmin) return;
    const controller = new AbortController();
    setLoadingUsers(true);
    fetchUserDirectory(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setUsers(result.users);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingUsers(false);
        }
      });
    return () => controller.abort();
  }, [isAdmin]);

  const userNames = Array.from(
    new Set([
      ...(defaultName ? [defaultName] : []),
      ...users.map((u) => u.name).filter(Boolean),
    ])
  );

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
        <Label htmlFor="checked_out_by_name">
          Checked out by *
          {!isAdmin && (
            <span className="text-xs text-muted-foreground font-normal ml-1.5">
              (OAuth account)
            </span>
          )}
        </Label>
        {isAdmin ? (
          <select
            id="checked_out_by_name"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground"
            disabled={isSubmitting}
            {...register("checked_out_by_name")}
          >
            {userNames.length === 0 && (
              <option value={defaultName ?? ""}>
                {loadingUsers ? "Loading users…" : (defaultName || "Select user…")}
              </option>
            )}
            {userNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="checked_out_by_name"
            readOnly
            tabIndex={-1}
            className="bg-muted cursor-not-allowed select-none opacity-80 pointer-events-none"
            {...register("checked_out_by_name")}
          />
        )}
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
