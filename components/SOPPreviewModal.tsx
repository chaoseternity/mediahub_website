"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookOpen, FileText, Calendar, User } from "lucide-react";
import type { SOPDocument, SOPCitation } from "@/lib/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SOPPreviewModalProps {
  document: SOPDocument | null;
  citation?: SOPCitation | null;
  open: boolean;
  onClose: () => void;
}

export function SOPPreviewModal({
  document,
  citation,
  open,
  onClose,
}: SOPPreviewModalProps) {
  if (!document) return null;

  // Highlight citation snippet in the text if present
  const renderContent = () => {
    if (!citation?.snippet) {
      return (
        <div className="text-xs leading-relaxed text-foreground/90 bg-muted/20 p-4 rounded-lg border max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              h1: ({ children }) => <h1 className="text-base font-bold my-2 text-foreground">{children}</h1>,
              h2: ({ children }) => <h2 className="text-sm font-bold my-2 text-foreground">{children}</h2>,
              h3: ({ children }) => <h3 className="text-xs font-bold my-1.5 uppercase text-purple-700 dark:text-purple-300">{children}</h3>,
              code: ({ children }) => (
                <code className="px-1.5 py-0.5 rounded bg-muted/80 font-mono text-xs border">{children}</code>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-2 border rounded-lg">
                  <table className="w-full text-xs text-left">{children}</table>
                </div>
              ),
              th: ({ children }) => <th className="px-3 py-2 font-semibold bg-muted/60 border-b">{children}</th>,
              td: ({ children }) => <td className="px-3 py-2 border-b border-muted/40">{children}</td>,
            }}
          >
            {document.content}
          </ReactMarkdown>
        </div>
      );
    }

    const snippetClean = citation.snippet.trim();
    const content = document.content;
    const index = content.toLowerCase().indexOf(snippetClean.toLowerCase());

    if (index === -1) {
      return (
        <div className="space-y-3">
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs">
            <span className="font-semibold text-amber-700 dark:text-amber-300 block mb-1">
              Cited Reference Snippet:
            </span>
            <p className="italic text-foreground/90">&ldquo;{citation.snippet}&rdquo;</p>
          </div>
          <pre className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground/90 bg-muted/20 p-4 rounded-lg border">
            {document.content}
          </pre>
        </div>
      );
    }

    const before = content.substring(0, index);
    const match = content.substring(index, index + snippetClean.length);
    const after = content.substring(index + snippetClean.length);

    return (
      <div className="space-y-3">
        <div className="p-2.5 bg-purple-500/10 border border-purple-500/30 rounded-lg text-xs flex items-center gap-2">
          <span className="font-semibold text-purple-700 dark:text-purple-300">
            Highlighted Citation:
          </span>
          <span className="text-muted-foreground text-[11px]">
            The exact excerpt referenced by the AI is highlighted in purple below.
          </span>
        </div>

        <div className="text-xs whitespace-pre-wrap font-sans leading-relaxed text-foreground/90 bg-muted/20 p-4 rounded-lg border">
          {before}
          <mark className="bg-purple-200 dark:bg-purple-900/60 text-purple-900 dark:text-purple-100 font-semibold px-1 py-0.5 rounded">
            {match}
          </mark>
          {after}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary shrink-0" />
            <DialogTitle className="text-lg font-bold truncate">
              {document.title}
            </DialogTitle>
            <Badge variant="secondary" className="text-xs shrink-0">
              {document.category}
            </Badge>
          </div>
        </DialogHeader>

        {/* Metadata bar */}
        <div className="flex flex-wrap items-center gap-3 py-2 px-3 bg-muted/30 border rounded-lg text-xs text-muted-foreground">
          {document.file_name && (
            <span className="flex items-center gap-1">
              <FileText className="h-3.5 w-3.5 text-primary" />
              {document.file_name}
            </span>
          )}
          {document.uploaded_by_name && (
            <span className="flex items-center gap-1">
              <User className="h-3.5 w-3.5" />
              Uploaded by {document.uploaded_by_name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Calendar className="h-3.5 w-3.5" />
            Updated {new Date(document.updated_at).toLocaleDateString("en-GB")}
          </span>
        </div>

        {/* Content View */}
        <div className="py-2">
          {renderContent()}
        </div>

        <DialogFooter className="border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
