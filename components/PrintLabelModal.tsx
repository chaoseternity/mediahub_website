"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { Printer, Download, QrCode, Barcode, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { parseEquipmentId } from "@/lib/utils";
import type { Equipment, EquipmentDetail } from "@/lib/types";

interface PrintLabelModalProps {
  equipment: Equipment | EquipmentDetail | null;
  open: boolean;
  onClose: () => void;
}

export function PrintLabelModal({ equipment, open, onClose }: PrintLabelModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const barcodeSvgRef = useRef<SVGSVGElement | null>(null);
  const labelRef = useRef<HTMLDivElement | null>(null);

  const codeValue = equipment?.serial_number?.trim() || equipment?.name?.trim() || "N/A";
  const parsedId = equipment ? parseEquipmentId(equipment.serial_number) : null;

  useEffect(() => {
    if (open && equipment && codeValue) {
      // 1. Generate QR Code
      QRCode.toDataURL(codeValue, {
        width: 300,
        margin: 1,
        color: {
          dark: "#000000",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error("Failed to generate QR code", err));

      // 2. Generate Barcode (Code128)
      if (barcodeSvgRef.current) {
        try {
          JsBarcode(barcodeSvgRef.current, codeValue, {
            format: "CODE128",
            width: 1.8,
            height: 48,
            displayValue: true,
            fontSize: 12,
            font: "monospace",
            margin: 4,
          });
        } catch (err) {
          console.error("Failed to generate barcode", err);
        }
      }
    }
  }, [open, equipment, codeValue]);

  if (!equipment) return null;

  function handlePrint() {
    window.print();
  }

  function handleDownloadQR() {
    if (!qrDataUrl) return;
    const a = document.createElement("a");
    a.href = qrDataUrl;
    a.download = `QR_${codeValue}.png`;
    a.click();
  }

  function handleDownloadBarcode() {
    if (!barcodeSvgRef.current) return;
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(barcodeSvgRef.current);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Barcode_${codeValue}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <QrCode className="h-5 w-5 text-primary" />
            <Barcode className="h-5 w-5 text-primary" />
            Equipment Label & QR/Barcode
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-xs text-muted-foreground">
            Print or download high-resolution QR and Code128 Barcode labels for physical equipment stickers.
          </p>

          {/* Printable Label Box */}
          <div
            id="printable-equipment-label"
            ref={labelRef}
            className="border-2 border-dashed border-primary/30 rounded-xl p-4 bg-white text-black shadow-sm flex flex-col items-center text-center space-y-3"
          >
            <div className="flex items-center justify-between w-full border-b pb-1.5 px-1">
              <span className="font-bold text-xs tracking-wider uppercase text-gray-700">MediaHub</span>
              {equipment.tags && equipment.tags.length > 0 && (
                <span className="text-[10px] font-medium bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded">
                  {equipment.tags.join(" • ")}
                </span>
              )}
            </div>

            {/* Equipment Name & ID */}
            <div>
              <h3 className="font-bold text-sm leading-tight text-gray-900">{equipment.name}</h3>
              {equipment.serial_number && (
                <div className="inline-flex items-center font-mono text-xs font-bold bg-gray-100 border px-2 py-0.5 rounded mt-1 text-gray-900">
                  <span>{parsedId?.partA}</span>
                  {parsedId?.partB && <span>-{parsedId.partB}</span>}
                  {parsedId?.partC && <span>-{parsedId.partC}</span>}
                </div>
              )}
            </div>

            {/* Side-by-side QR Code and Barcode */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full pt-1">
              {/* QR Code */}
              {qrDataUrl && (
                <div className="flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt={`QR code for ${codeValue}`}
                    className="w-24 h-24 border rounded p-1 bg-white"
                  />
                  <span className="text-[9px] font-mono text-gray-500 mt-0.5">QR Code</span>
                </div>
              )}

              {/* Code 128 Barcode */}
              <div className="flex flex-col items-center overflow-x-auto max-w-full">
                <svg ref={barcodeSvgRef} className="max-w-[180px] h-14" />
              </div>
            </div>

            <div className="flex items-center justify-between w-full text-[10px] text-gray-500 border-t pt-1.5 px-1">
              <span>Location: {equipment.location}</span>
              <span>Condition: {equipment.condition}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadQR}
              className="text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download QR (PNG)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadBarcode}
              className="text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Download Barcode (SVG)
            </Button>
          </div>
        </div>

        <DialogFooter className="pt-2 border-t flex items-center justify-between sm:justify-between">
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" />
            Print Label
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
