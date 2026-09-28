"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarClock,
  Plus,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  Package,
  User as UserIcon,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { Equipment, Reservation, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ReservationsClientProps {
  initialReservations: Reservation[];
  equipmentList: Equipment[];
  role: Role;
  currentUserId: number | null;
  currentUserName: string;
}

function fmtDate(dStr: string) {
  try {
    const d = new Date(dStr);
    return isNaN(d.getTime())
      ? dStr
      : d.toLocaleDateString("en-SG", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
  } catch {
    return dStr;
  }
}

export function ReservationsClient({
  initialReservations,
  equipmentList,
  role,
  currentUserId,
  currentUserName,
}: ReservationsClientProps) {
  const router = useRouter();
  const [reservations, setReservations] = useState<Reservation[]>(initialReservations);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedEquipmentId, setSelectedEquipmentId] = useState<number | "">("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [purpose, setPurpose] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Fulfillment State
  const [fulfillingId, setFulfillingId] = useState<number | null>(null);

  const isAdmin = role === "admin";
  const canCreate = role === "admin" || role === "verified";

  // Filtered reservations
  const filtered = reservations.filter((r) => {
    const matchesSearch =
      (r.equipment_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.reserved_by_name || "").toLowerCase().includes(search.toLowerCase()) ||
      (r.notes || "").toLowerCase().includes(search.toLowerCase());

    const matchesStatus = filterStatus === "all" || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  async function handleCreateReservation(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedEquipmentId || !startDate || !endDate) {
      setErrorMessage("Please select equipment and date range.");
      return;
    }
    if (new Date(startDate) >= new Date(endDate)) {
      setErrorMessage("End date must be strictly after the start date.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipment_id: Number(selectedEquipmentId),
          start_date: new Date(startDate).toISOString(),
          end_date: new Date(endDate).toISOString(),
          purpose,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data.error || "Failed to create reservation");
        return;
      }

      setReservations([data, ...reservations]);
      setIsCreateOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      console.error(err);
      setErrorMessage("Network error creating reservation.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancelReservation(id: number) {
    if (!confirm("Are you sure you want to cancel this reservation?")) return;
    try {
      const res = await fetch(`/api/reservations/${id}`, { method: "DELETE" });
      if (res.ok) {
        setReservations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "cancelled" as const } : r))
        );
        router.refresh();
      } else {
        const d = await res.json();
        alert(d.error || "Failed to cancel reservation");
      }
    } catch (err) {
      console.error(err);
      alert("Error cancelling reservation");
    }
  }

  async function handleFulfillReservation(id: number) {
    try {
      setFulfillingId(id);
      const res = await fetch(`/api/reservations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fulfill" }),
      });
      const data = await res.json();
      if (res.ok) {
        setReservations((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: "fulfilled" as const } : r))
        );
        alert("Reservation fulfilled! Equipment has been checked out.");
        router.refresh();
      } else {
        alert(data.error || "Cannot fulfill reservation");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to fulfill reservation");
    } finally {
      setFulfillingId(null);
    }
  }

  function resetForm() {
    setSelectedEquipmentId("");
    setStartDate("");
    setEndDate("");
    setPurpose("");
    setErrorMessage(null);
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <CalendarClock className="h-6 w-6 text-primary" />
            Gear Reservations
          </h2>
          <p className="text-muted-foreground text-sm">
            Book future equipment and automatically prevent overlapping project conflicts.
          </p>
        </div>

        {canCreate && (
          <Button onClick={() => setIsCreateOpen(true)} className="gap-1.5 self-start sm:self-auto">
            <Plus className="h-4 w-4" />
            New Reservation
          </Button>
        )}
      </div>

      {/* Controls & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by gear, member, or purpose..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {["all", "confirmed", "fulfilled", "cancelled"].map((status) => (
            <Button
              key={status}
              variant={filterStatus === status ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus(status)}
              className="text-xs capitalize h-8"
            >
              {status}
            </Button>
          ))}
        </div>
      </div>

      {/* Reservation Cards List */}
      {filtered.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="py-12 text-center text-muted-foreground space-y-2">
            <CalendarClock className="h-10 w-10 mx-auto opacity-30 text-muted-foreground" />
            <p className="font-medium text-foreground">No reservations found</p>
            <p className="text-xs">
              {search || filterStatus !== "all"
                ? "Try clearing your filters or search keywords."
                : "Plan ahead and reserve cameras, lenses, and gear for upcoming productions."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((res) => {
            const isOwner = currentUserId === res.reserved_by;
            const canManage = isAdmin || isOwner;
            const isConfirmed = res.status === "confirmed";

            return (
              <Card
                key={res.id}
                className={cn(
                  "flex flex-col justify-between border transition-all hover:shadow-sm",
                  res.status === "cancelled" && "opacity-60 bg-muted/30",
                  res.status === "fulfilled" && "border-green-200 dark:border-green-950/60"
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base font-semibold truncate flex items-center gap-1.5">
                        <Package className="h-4 w-4 text-primary shrink-0" />
                        <span className="truncate">{res.equipment_name}</span>
                      </CardTitle>
                      <CardDescription className="text-xs text-muted-foreground truncate">
                        ID: {res.equipment_serial_number || `#${res.equipment_id}`}
                      </CardDescription>
                    </div>

                    <Badge
                      variant={
                        res.status === "confirmed"
                          ? "default"
                          : res.status === "fulfilled"
                          ? "secondary"
                          : "outline"
                      }
                      className="text-xs capitalize shrink-0"
                    >
                      {res.status}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pb-3 text-xs">
                  <div className="bg-muted/40 p-2.5 rounded-lg space-y-1.5">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-medium">Reserved Period:</span>
                    </div>
                    <div className="flex items-center gap-1.5 font-medium text-foreground">
                      <Clock className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span>{fmtDate(res.start_time)}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-muted-foreground pl-5">
                      <span>to</span>
                      <span className="font-medium text-foreground">{fmtDate(res.end_time)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <UserIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Reserved by: <strong className="text-foreground">{res.reserved_by_name}</strong>
                    </span>
                  </div>

                  {res.notes && (
                    <p className="text-muted-foreground italic text-[11px] line-clamp-2">
                      &ldquo;{res.notes}&rdquo;
                    </p>
                  )}
                </CardContent>

                {isConfirmed && canManage && (
                  <div className="px-4 py-2.5 bg-muted/20 border-t flex items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCancelReservation(res.id)}
                      className="text-xs text-destructive hover:bg-destructive/10 h-7 px-2"
                    >
                      Cancel
                    </Button>

                    <Button
                      variant="default"
                      size="sm"
                      disabled={fulfillingId === res.id}
                      onClick={() => handleFulfillReservation(res.id)}
                      className="text-xs h-7 gap-1"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {fulfillingId === res.id ? "Checking Out..." : "Fulfill / Check Out"}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* New Reservation Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateReservation} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-primary" />
                Reserve Equipment
              </DialogTitle>
              <DialogDescription>
                Schedule gear in advance. Conflicting dates will be automatically detected.
              </DialogDescription>
            </DialogHeader>

            {errorMessage && (
              <div className="p-3 text-xs bg-destructive/10 text-destructive rounded-lg flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{errorMessage}</span>
              </div>
            )}

            <div className="space-y-3 text-sm">
              <div className="space-y-1">
                <Label htmlFor="equipmentSelect">Select Gear</Label>
                <select
                  id="equipmentSelect"
                  value={selectedEquipmentId}
                  onChange={(e) => setSelectedEquipmentId(Number(e.target.value) || "")}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:ring-1 focus:ring-ring"
                  required
                >
                  <option value="">-- Choose Equipment --</option>
                  {equipmentList.map((eq) => (
                    <option key={eq.id} value={eq.id}>
                      {eq.name} ({eq.serial_number || "No Serial"}) — {eq.status}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="resStart">Start Date & Time</Label>
                  <Input
                    id="resStart"
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="resEnd">End Date & Time</Label>
                  <Input
                    id="resEnd"
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="resPurpose">Project / Production Purpose</Label>
                <textarea
                  id="resPurpose"
                  placeholder="e.g., Short film shoot, Graduation ceremony livestream, etc."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Checking Conflicts..." : "Confirm Reservation"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
