"use client";

import { Tag, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Equipment } from "@/lib/types";

interface EquipmentCardProps {
  equipment: Equipment;
  onClick: () => void;
}

const statusVariant: Record<
  Equipment["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  Available: "default",
  "Checked Out": "secondary",
  "In Event": "secondary",
  "In Event (Rehearsal)": "secondary",
  "Under Maintenance": "outline",
  Retired: "destructive",
};

const statusColour: Record<Equipment["status"], string> = {
  Available: "bg-green-100 text-green-800 border-green-200",
  "Checked Out": "bg-yellow-100 text-yellow-800 border-yellow-200",
  "In Event": "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-300",
  "In Event (Rehearsal)": "bg-purple-200 text-purple-900 border-purple-300 dark:bg-purple-950 dark:text-purple-200",
  "Under Maintenance": "bg-blue-100 text-blue-800 border-blue-200",
  Retired: "bg-red-100 text-red-800 border-red-200",
};

export function EquipmentCard({ equipment, onClick }: EquipmentCardProps) {
  return (
    <Card
      className="cursor-pointer hover:shadow-lg hover:-translate-y-0.5 hover:ring-1 hover:ring-primary/20 transition-all duration-200 flex flex-col"
      onClick={onClick}
      data-testid="equipment-card"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-tight">{equipment.name}</CardTitle>
          <Badge
            variant={statusVariant[equipment.status]}
            className={`shrink-0 text-xs ${statusColour[equipment.status]}`}
            data-testid="status-badge"
          >
            {equipment.status}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          <span className="flex flex-wrap gap-1">
            {equipment.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
              >
                <Tag className="h-3 w-3 shrink-0" />
                {tag}
              </span>
            ))}
            {equipment.tags.length === 0 && (
              <span className="italic text-muted-foreground">No tags</span>
            )}
          </span>
        </p>
      </CardHeader>

      <CardContent className="pb-2 flex-1">
        <dl className="space-y-1 text-sm">
          <div className="flex gap-1">
            <dt className="text-muted-foreground shrink-0">Location:</dt>
            <dd className="font-medium truncate">
              {equipment.status === "Checked Out"
                ? (equipment.checkout_location || `With ${equipment.checked_out_by_name}`)
                : equipment.status === "In Event"
                ? (equipment.active_event_location || equipment.location)
                : equipment.location}
            </dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground shrink-0">Condition:</dt>
            <dd>{equipment.condition}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="text-muted-foreground shrink-0">Qty:</dt>
            <dd>{equipment.quantity}</dd>
          </div>
          {equipment.status === "Checked Out" && equipment.checked_out_by_name && (
            <div className="flex gap-1">
              <dt className="text-muted-foreground shrink-0">With:</dt>
              <dd className="truncate">{equipment.checked_out_by_name}</dd>
            </div>
          )}
          {equipment.status === "In Event" && equipment.active_event_name && (
            <div className="pt-1 mt-1 border-t text-xs text-purple-700 dark:text-purple-300 font-medium">
              <div className="flex items-center gap-1 truncate">
                <Calendar className="h-3 w-3 shrink-0" />
                <span className="truncate">Used by Event: {equipment.active_event_name}</span>
              </div>
              {equipment.active_event_end_time && (
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Possession until: {new Date(equipment.active_event_end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </div>
          )}
        </dl>
      </CardContent>

      <CardFooter className="pt-2">
        <p className="text-xs text-muted-foreground/70 italic">Click to view details</p>
      </CardFooter>
    </Card>
  );
}
