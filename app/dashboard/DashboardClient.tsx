"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, Package, Download, Upload, Bell, Loader2, Radio } from "lucide-react";
import { AddEquipmentModal } from "@/components/AddEquipmentModal";
import { UploadEquipmentModal } from "@/components/UploadEquipmentModal";
import { generateEquipmentExcel } from "@/lib/excel";
import type { Equipment, Role } from "@/lib/types";
import { APP_TIMEZONE, parseDueDate } from "@/lib/timezone";
import { useNow } from "@/lib/use-now";

const EquipmentGrid = dynamic(
  () => import("@/components/EquipmentGrid").then((m) => m.EquipmentGrid),
  { ssr: false }
);

interface DashboardClientProps {
  initialData: Equipment[];
  role: Role;
  userName: string;
}

export function DashboardClient({ initialData, role, userName }: DashboardClientProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCheckingReminders, setIsCheckingReminders] = useState(false);
  const [items, setItems] = useState<Equipment[]>(initialData);
  const router = useRouter();

  // Computed after mount only (now === null during SSR) to avoid a hydration mismatch.
  // Date-only due dates are due until the end of that day in the club's time zone.
  const now = useNow();
  const overdueCount =
    now === null
      ? 0
      : items.filter((i) => {
          if (i.status !== "Checked Out") return false;
          const due = parseDueDate(i.expected_return_at);
          return due !== null && now > due.getTime();
        }).length;

  const [isTestingWebhook, setIsTestingWebhook] = useState(false);

  async function handleTestWebhook() {
    try {
      setIsTestingWebhook(true);
      const res = await fetch("/api/webhooks/test", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(
          `Discord & Club Webhook Test Complete:\n\n` +
            `• Configured Targets: ${Array.isArray(data.channels) && data.channels.length > 0 ? data.channels.join(", ") : "Discord webhook URL pending (Logged to server console in dev mode)"}\n` +
            `• Summary: ${data.message}\n\n` +
            `Tip: Add DISCORD_WEBHOOK_URL to your environment variables to receive live gear alerts in Discord channels.`
        );
      } else {
        alert(data.error || "Failed to broadcast webhook");
      }
    } catch (err) {
      console.error("Webhook test failed:", err);
      alert("Failed to trigger Discord webhook broadcast.");
    } finally {
      setIsTestingWebhook(false);
    }
  }

  async function handleTriggerReminders() {
    try {
      setIsCheckingReminders(true);
      const res = await fetch("/api/cron/reminders", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        alert(
          `Return Reminders Check Complete:\n\n` +
            `• Total Active Loans Checked: ${data.totalChecked}\n` +
            `• Reminders Dispatched: ${data.sent}\n` +
            `• Skipped (Already reminded / Not due): ${data.skipped}` +
            (data.errors ? `\n• Errors: ${data.errors}` : "")
        );
      } else {
        alert(data.error || "Failed to trigger return reminders.");
      }
    } catch (err) {
      console.error("Reminder check failed:", err);
      alert("Failed to connect to reminder service.");
    } finally {
      setIsCheckingReminders(false);
    }
  }

  async function refresh() {
    try {
      const res = await fetch("/api/equipment");
      if (res.ok) {
        const data: unknown = await res.json();
        if (Array.isArray(data)) setItems(data as Equipment[]);
      }
    } catch (err) {
      console.error("Failed to refresh equipment list:", err);
    }
    router.refresh();
  }

  function handleDownload() {
    try {
      setIsDownloading(true);
      const buffer = generateEquipmentExcel(items);
      const blob = new Blob([buffer as Uint8Array<ArrayBuffer>], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // en-CA formats as YYYY-MM-DD; use the club's date, not the UTC date.
      const today = new Date().toLocaleDateString("en-CA", { timeZone: APP_TIMEZONE });
      a.download = `MediaHub_Equipment_${today}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
      alert("Failed to generate Excel file.");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <div className="px-4 py-4 md:px-6 md:py-8 w-full space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6 text-primary" />
            Equipment
          </h2>
          <p className="text-muted-foreground text-sm">{items.length} items total</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={isDownloading || items.length === 0}
            className="sm:w-auto gap-1.5"
            title="Download equipment data as Excel"
          >
            <Download className="h-4 w-4" />
            Download
          </Button>

          {role === "admin" && (
            <>
              <Button
                variant="outline"
                onClick={handleTestWebhook}
                disabled={isTestingWebhook}
                className="sm:w-auto gap-1.5"
                title="Test broadcast webhook notification to configured Discord channel"
              >
                {isTestingWebhook ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Radio className="h-4 w-4 text-indigo-500" />
                )}
                Discord Webhook
              </Button>
              <Button
                variant="outline"
                onClick={handleTriggerReminders}
                disabled={isCheckingReminders}
                className="sm:w-auto gap-1.5"
                title="Check and send return reminder emails to borrowers"
              >
                {isCheckingReminders ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Bell className={`h-4 w-4 ${overdueCount > 0 ? "text-destructive" : "text-primary"}`} />
                )}
                Reminders
                {overdueCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-destructive text-destructive-foreground">
                    {overdueCount}
                  </span>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => setUploadOpen(true)}
                className="sm:w-auto gap-1.5"
                title="Upload equipment Excel spreadsheet"
              >
                <Upload className="h-4 w-4" />
                Upload
              </Button>
              <Button onClick={() => setAddOpen(true)} className="sm:w-auto gap-1.5">
                <Plus className="h-4 w-4" />
                Add Equipment
              </Button>
            </>
          )}
        </div>
      </div>

      <EquipmentGrid
        initialData={items}
        role={role}
        userName={userName}
        onRefresh={refresh}
      />

      {role === "admin" && (
        <>
          <AddEquipmentModal
            open={addOpen}
            onClose={() => setAddOpen(false)}
            onCreated={refresh}
          />
          <UploadEquipmentModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onSuccess={refresh}
            existingEquipment={items}
          />
        </>
      )}
    </div>
  );
}
