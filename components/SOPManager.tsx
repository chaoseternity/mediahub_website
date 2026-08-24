"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bot,
  BookOpen,
  Upload,
  Send,
  Trash2,
  FileText,
  Sparkles,
  Search,
  AlertCircle,
  Clock,
  User,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  FileCode,
  FileUp,
  RotateCcw,
  X,
  CheckCircle2,
  Plus,
  Eye,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { SOPPreviewModal } from "./SOPPreviewModal";
import type { SOPDocument, SOPCitation, AIChatMessage, Role } from "@/lib/types";
import JSZip from "jszip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SOPManagerProps {
  initialDocuments: SOPDocument[];
  role: Role;
  userName: string;
}

interface StagedFile {
  id: string;
  file: File;
  title: string;
  category: string;
  content: string;
  status: "ready" | "extracting" | "error";
  error?: string;
  wordCount: number;
  isExpanded?: boolean;
}

const PRESET_QUESTIONS = [
  "What is our procedure for returning damaged equipment?",
  "Which cameras and lenses are currently available in inventory?",
  "What is the mass/weight and specs of a Sony FX3 camera?",
  "Where are our wireless microphone kits stored?",
];

const CATEGORIES = ["All", "General", "Photo", "Video", "Audio/AV", "Safety & Handling", "Events"];
const DOC_CATEGORIES = ["General", "Photo", "Video", "Audio/AV", "Safety & Handling", "Events"];

const SESSION_STORAGE_KEY = "mediahub_ai_chat_session";

function getWelcomeMessage(name: string): AIChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    content: `Hello ${name}! 👋 I am your **MediaHub AI Operations Assistant**, powered by Google Gemini.\n\nI have real-time access to:\n1. 📋 **Official SOPs & Guidelines** (handling rules, safety protocols, return checklists)\n2. 📦 **Live Inventory & Availability** (equipment status, storage locations, active checkouts)\n3. 🌐 **Technical Gear Specifications & Specs** (camera mass, lens compatibility, sensor specs)\n\nAsk me anything or tap one of the suggested prompts below!`,
    created_at: new Date().toISOString(),
  };
}

export function SOPManager({ initialDocuments, role, userName }: SOPManagerProps) {
  const [documents, setDocuments] = useState<SOPDocument[]>(initialDocuments);
  const [activeTab, setActiveTab] = useState<"assistant" | "library">("assistant");

  // Chat State initialized from sessionStorage for current browser tab
  const [messages, setMessages] = useState<AIChatMessage[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch (e) {
        console.warn("Could not parse chat from sessionStorage", e);
      }
    }
    return [getWelcomeMessage(userName)];
  });

  const [inputQuery, setInputQuery] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Document Library & Upload State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadModalTab, setUploadModalTab] = useState<"file" | "manual">("file");

  // Multi-File Upload Queue
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; currentName: string } | null>(null);
  const [uploadingBatch, setUploadingBatch] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Inspected Staged File Modal (for full-screen extracted text inspection & editing)
  const [inspectingFileId, setInspectingFileId] = useState<string | null>(null);

  // Manual Entry Form State
  const [manualTitle, setManualTitle] = useState("");
  const [manualCategory, setManualCategory] = useState("General");
  const [manualContent, setManualContent] = useState("");
  const [savingManual, setSavingManual] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<SOPDocument | null>(null);
  const [previewCitation, setPreviewCitation] = useState<SOPCitation | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const isAdmin = role === "admin";

  // Auto-save chat messages to sessionStorage on every change
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(messages));
      } catch (e) {
        console.warn("Could not save chat to sessionStorage", e);
      }
    }
  }, [messages]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatLoading]);

  // Clear Chat History
  function handleClearChat() {
    if (confirm("Reset and clear your conversation history?")) {
      const reset = [getWelcomeMessage(userName)];
      setMessages(reset);
      try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(reset));
      } catch {}
    }
  }

  // Refresh documents list
  async function refreshDocuments() {
    try {
      const res = await fetch("/api/sop");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (e) {
      console.error("Failed to refresh SOP documents", e);
    }
  }

  // Extract text from a file (client-side for .docx, .txt, .md or server for .pdf)
  const extractFileText = useCallback(async (file: File): Promise<{ content: string; wordCount: number }> => {
    const nameLower = file.name.toLowerCase();

    // 1. Microsoft Word (.docx) client extraction via JSZip
    if (nameLower.endsWith(".docx")) {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const docXmlFile = zip.file("word/document.xml");

        if (docXmlFile) {
          const xml = await docXmlFile.async("text");
          const clean = xml
            .replace(/<w:p[^>]*>/g, "\n")
            .replace(/<w:tab[^>]*\/>/g, "\t")
            .replace(/<w:br[^>]*\/>/g, "\n")
            .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, "$1")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/\n\s*\n/g, "\n\n")
            .trim();

          const words = clean.split(/\s+/).filter(Boolean).length;
          if (clean.length > 0) {
            return { content: clean, wordCount: words };
          }
        }
      } catch (err) {
        console.warn("Client docx extraction fallback to parse API:", err);
      }
    }

    // 2. Plain Text / Markdown (.txt, .md, .csv)
    if (
      nameLower.endsWith(".txt") ||
      nameLower.endsWith(".md") ||
      nameLower.endsWith(".markdown") ||
      file.type.includes("text")
    ) {
      try {
        const text = await file.text();
        const clean = text.trim();
        const words = clean.split(/\s+/).filter(Boolean).length;
        return { content: clean, wordCount: words };
      } catch (err) {
        console.warn("Text extraction fallback:", err);
      }
    }

    // 3. For PDF or server-supported documents, call parse API
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/sop/parse", {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        const parseData = await res.json();
        return {
          content: parseData.content,
          wordCount: parseData.wordCount || parseData.content.split(/\s+/).filter(Boolean).length,
        };
      }
    } catch (err) {
      console.warn("Server parse API fallback:", err);
    }

    return {
      content: `[File selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]\nText will be extracted on the server.`,
      wordCount: 0,
    };
  }, []);

  // Handle addition of multiple files
  const handleFilesAdded = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      if (incoming.length === 0) return;

      setFormError(null);

      // Create provisional staged file records
      const newItems: StagedFile[] = incoming.map((file) => {
        const baseTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
        return {
          id: `${file.name}-${file.size}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          file,
          title: baseTitle,
          category: "General",
          content: "",
          status: "extracting",
          wordCount: 0,
          isExpanded: false,
        };
      });

      // Append to queue immediately with "extracting" status
      setStagedFiles((prev) => [...prev, ...newItems]);

      // Extract each file
      for (const item of newItems) {
        try {
          const { content, wordCount } = await extractFileText(item.file);
          setStagedFiles((prev) =>
            prev.map((f) =>
              f.id === item.id ? { ...f, content, wordCount, status: "ready" } : f
            )
          );
        } catch (err) {
          setStagedFiles((prev) =>
            prev.map((f) =>
              f.id === item.id
                ? {
                    ...f,
                    status: "error",
                    error: err instanceof Error ? err.message : "Failed to extract text",
                  }
                : f
            )
          );
        }
      }
    },
    [extractFileText]
  );

  // Remove a wrongly uploaded file from the staging queue
  function removeStagedFile(id: string) {
    setStagedFiles((prev) => prev.filter((f) => f.id !== id));
    if (inspectingFileId === id) setInspectingFileId(null);
  }

  // Update title of a staged file
  function updateStagedTitle(id: string, title: string) {
    setStagedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, title } : f)));
  }

  // Update category of a staged file
  function updateStagedCategory(id: string, category: string) {
    setStagedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, category } : f)));
  }

  // Update content of a staged file
  function updateStagedContent(id: string, content: string) {
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    setStagedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, content, wordCount } : f)));
  }

  // Toggle inline expansion of extracted text
  function toggleExpandStagedFile(id: string) {
    setStagedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, isExpanded: !f.isExpanded } : f))
    );
  }

  // Handle Batch Upload of All Staged Files
  async function handleBatchUpload() {
    if (stagedFiles.length === 0) {
      setFormError("Please select at least one document to upload.");
      return;
    }

    // Validate that all items have titles
    const missingTitle = stagedFiles.find((f) => !f.title.trim());
    if (missingTitle) {
      setFormError(`Please provide a title for "${missingTitle.file.name}".`);
      return;
    }

    setUploadingBatch(true);
    setFormError(null);
    let successCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < stagedFiles.length; i++) {
      const item = stagedFiles[i];
      setUploadProgress({
        current: i + 1,
        total: stagedFiles.length,
        currentName: item.file.name,
      });

      try {
        let res: Response;
        if (item.content && !item.content.startsWith("[File selected:")) {
          // Send fast JSON payload with pre-extracted clean text
          res = await fetch("/api/sop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: item.title.trim(),
              category: item.category,
              content: item.content.trim(),
              file_name: item.file.name,
              file_type: item.file.type || null,
              file_size: item.file.size,
            }),
          });
        } else {
          // Send FormData for server-side PDF parsing
          const formData = new FormData();
          formData.append("file", item.file);
          formData.append("title", item.title.trim());
          formData.append("category", item.category);

          res = await fetch("/api/sop", {
            method: "POST",
            body: formData,
          });
        }

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error (${res.status})`);
        }

        successCount++;
      } catch (err: unknown) {
        errors.push(`${item.file.name}: ${err instanceof Error ? err.message : "Failed to upload"}`);
      }
    }

    setUploadingBatch(false);
    setUploadProgress(null);

    if (errors.length > 0) {
      setFormError(`Uploaded ${successCount} of ${stagedFiles.length} files. Errors:\n${errors.join("\n")}`);
      // Keep only failed files in the list
      setStagedFiles((prev) => prev.filter((f) => errors.some((e) => e.startsWith(f.file.name))));
      refreshDocuments();
    } else {
      // All succeeded
      setUploadModalOpen(false);
      setStagedFiles([]);
      refreshDocuments();
    }
  }

  // Handle Save Manual Document
  async function handleSaveManualDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!manualTitle.trim()) {
      setFormError("Please provide a document title.");
      return;
    }
    if (!manualContent.trim()) {
      setFormError("Please enter document content.");
      return;
    }

    setSavingManual(true);
    setFormError(null);

    try {
      const res = await fetch("/api/sop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: manualTitle.trim(),
          category: manualCategory,
          content: manualContent.trim(),
          file_name: null,
          file_type: null,
          file_size: null,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }

      setUploadModalOpen(false);
      setManualTitle("");
      setManualContent("");
      setManualCategory("General");
      refreshDocuments();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save SOP document.");
    } finally {
      setSavingManual(false);
    }
  }

  // Handle Send Chat
  async function handleSendMessage(textToSend?: string) {
    const q = (textToSend || inputQuery).trim();
    if (!q || chatLoading) return;

    const userMsg: AIChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: q,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery("");
    setChatLoading(true);

    try {
      const historyPayload = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await fetch("/api/sop/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: q,
          history: historyPayload,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate AI response");
      }

      const data = await res.json();
      const botMsg: AIChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data.reply,
        citations: data.citations || [],
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: unknown) {
      const errMsg: AIChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `⚠️ **Error**: ${
          err instanceof Error ? err.message : "An unexpected error occurred while communicating with Gemini."
        }`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setChatLoading(false);
    }
  }

  // Handle Document Delete
  async function handleDeleteDocument(docId: number, title: string) {
    if (!confirm(`Are you sure you want to delete "${title}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/sop/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to delete document");
      }
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete document");
    }
  }

  // Filter Documents for Library
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.file_name && doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === "All" || doc.category.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

  const inspectingFile = stagedFiles.find((f) => f.id === inspectingFileId) || null;

  return (
    <div className="px-4 py-4 md:px-6 md:py-6 w-full space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b pb-4">
        <div>
          <h2 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6 text-purple-600 dark:text-purple-400" />
            SOP & AI Knowledge Assistant
          </h2>
          <p className="text-muted-foreground text-sm">
            Trained on official MediaHub Standard Operating Procedures with grounded Google Gemini AI and source citations
          </p>
        </div>

        {isAdmin && (
          <Button
            onClick={() => {
              setFormError(null);
              setStagedFiles([]);
              setManualTitle("");
              setManualContent("");
              setUploadModalOpen(true);
            }}
            className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5 shadow-sm text-xs md:text-sm"
          >
            <Upload className="h-4 w-4" />
            Add SOP Document
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "assistant" | "library")} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="assistant" className="gap-2">
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            AI SOP Assistant
          </TabsTrigger>
          <TabsTrigger value="library" className="gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            SOP Library ({documents.length})
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 1: AI SOP ASSISTANT
            ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="assistant" className="space-y-4 pt-2">
          {documents.length === 0 && (
            <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>No SOP documents uploaded yet. Upload SOP files in the <strong>SOP Library</strong> tab for the AI to learn from!</span>
              </div>
              {isAdmin && (
                <Button size="sm" variant="outline" onClick={() => setUploadModalOpen(true)} className="h-7 text-xs">
                  Add SOP Now
                </Button>
              )}
            </div>
          )}

          {/* Chat Container */}
          <div className="border rounded-xl bg-card flex flex-col h-[calc(100dvh-260px)] min-h-[480px] md:h-[650px] shadow-sm overflow-hidden">
            {/* Chat Header Bar */}
            <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="font-semibold text-foreground">MediaHub AI Agent</span>
                <Badge variant="outline" className="text-[10px] font-normal py-0 h-4 bg-background">
                  Gemini 3.5 Flash-Lite
                </Badge>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground hidden sm:inline">
                  {messages.length - 1} message{messages.length - 1 === 1 ? "" : "s"} in session
                </span>
                {messages.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleClearChat}
                    className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground gap-1"
                    title="Clear current chat history"
                  >
                    <RotateCcw className="h-3 w-3" />
                    New Chat
                  </Button>
                )}
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {m.role === "assistant" && (
                    <div className="h-8 w-8 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                      <Bot className="h-4.5 w-4.5" />
                    </div>
                  )}

                  <div
                    className={`rounded-2xl px-4 py-3 max-w-[85%] sm:max-w-[75%] space-y-2.5 shadow-xs ${
                      m.role === "user"
                        ? "bg-primary text-primary-foreground ml-8"
                        : "bg-muted/50 border text-foreground mr-8"
                    }`}
                  >
                    {/* Message Body */}
                    <div className="text-sm leading-relaxed max-w-none break-words">
                      {m.role === "user" ? (
                        <div className="whitespace-pre-wrap">{m.content}</div>
                      ) : (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            p: ({ children }) => <p className="mb-2.5 last:mb-0 leading-relaxed">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            ul: ({ children }) => <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>,
                            li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
                            h1: ({ children }) => <h1 className="text-base font-bold my-2 text-foreground">{children}</h1>,
                            h2: ({ children }) => <h2 className="text-sm font-bold my-2 text-foreground">{children}</h2>,
                            h3: ({ children }) => <h3 className="text-xs font-bold my-1.5 uppercase tracking-wide text-purple-700 dark:text-purple-300">{children}</h3>,
                            code: ({ children }) => (
                              <code className="px-1.5 py-0.5 rounded bg-muted/80 font-mono text-xs border">{children}</code>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-2 border-purple-500 pl-3 my-2 italic text-muted-foreground">{children}</blockquote>
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
                          {m.content}
                        </ReactMarkdown>
                      )}
                    </div>

                    {/* Citations Pill Bar */}
                    {m.citations && m.citations.length > 0 && (
                      <div className="pt-2 border-t border-border/40 space-y-1.5">
                        <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                          <BookOpen className="h-3 w-3 text-purple-600" />
                          Grounded Citations & Sources:
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                          {m.citations.map((c, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                const fullDoc = documents.find((d) => d.id === c.document_id);
                                if (fullDoc) {
                                  setPreviewDoc(fullDoc);
                                  setPreviewCitation(c);
                                  setPreviewOpen(true);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/40 dark:hover:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[11px] font-medium border border-purple-200 dark:border-purple-800 transition-colors"
                            >
                              <FileText className="h-2.5 w-2.5" />
                              <span className="truncate max-w-[140px]">{c.document_title}</span>
                              <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-3 items-start">
                  <div className="h-8 w-8 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm animate-pulse">
                    <Bot className="h-4.5 w-4.5" />
                  </div>
                  <div className="rounded-2xl px-4 py-3 bg-muted/50 border text-foreground text-sm flex items-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-purple-600" />
                    <span className="text-xs text-muted-foreground">Consulting SOP database & inventory…</span>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Suggested Question Pills */}
            <div className="px-4 py-2 bg-muted/20 border-t flex gap-2 overflow-x-auto text-xs no-scrollbar">
              <span className="text-[11px] font-medium text-muted-foreground self-center shrink-0">
                Suggested:
              </span>
              {PRESET_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSendMessage(q)}
                  disabled={chatLoading}
                  className="px-2.5 py-1 rounded-full bg-background hover:bg-accent border text-[11px] text-muted-foreground hover:text-foreground whitespace-nowrap shrink-0 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="p-3 border-t bg-background flex gap-2 items-center">
              <Input
                placeholder="Ask about SOP rules, camera specs, or live gear availability..."
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                disabled={chatLoading}
                className="text-xs md:text-sm h-10"
              />
              <Button
                onClick={() => handleSendMessage()}
                disabled={chatLoading || !inputQuery.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white h-10 px-4 shrink-0 gap-1.5"
              >
                <Send className="h-4 w-4" />
                <span className="hidden sm:inline">Ask</span>
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2: SOP DOCUMENT LIBRARY
            ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="library" className="space-y-4 pt-2">
          {/* Search & Category Filter Toolbar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search SOP title, keyword, or text content..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 h-9 text-xs md:text-sm"
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {CATEGORIES.map((cat) => (
                <Button
                  key={cat}
                  variant={selectedCategory === cat ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs h-8 whitespace-nowrap ${
                    selectedCategory === cat ? "bg-purple-600 hover:bg-purple-700 text-white" : ""
                  }`}
                >
                  {cat}
                </Button>
              ))}
            </div>
          </div>

          {/* Document Cards Grid */}
          {filteredDocuments.length === 0 ? (
            <div className="p-12 text-center border rounded-xl bg-card space-y-3">
              <FolderOpen className="h-10 w-10 text-muted-foreground/40 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">No SOP documents found</p>
                <p className="text-xs text-muted-foreground">
                  {searchQuery || selectedCategory !== "All"
                    ? "Try adjusting your search filters."
                    : "Get started by uploading official PDF, Word, or Markdown SOPs."}
                </p>
              </div>
              {isAdmin && !searchQuery && (
                <Button
                  onClick={() => {
                    setFormError(null);
                    setStagedFiles([]);
                    setUploadModalOpen(true);
                  }}
                  className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5 text-xs h-8 mt-2"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload First SOP
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="border rounded-xl p-4 bg-card hover:shadow-md transition-shadow flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <Badge variant="outline" className="text-[10px] font-medium bg-muted/40">
                        {doc.category}
                      </Badge>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteDocument(doc.id, doc.title)}
                          className="h-6 w-6 text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-1 -mt-1"
                          title="Delete SOP document"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>

                    <h3 className="font-bold text-sm text-foreground line-clamp-1 leading-snug">
                      {doc.title}
                    </h3>

                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {doc.content}
                    </p>
                  </div>

                  <div className="pt-3 border-t space-y-2 text-[11px] text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(doc.created_at).toLocaleDateString()}
                      </span>
                      {doc.uploaded_by_name && (
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" />
                          {doc.uploaded_by_name}
                        </span>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setPreviewDoc(doc);
                        setPreviewCitation(null);
                        setPreviewOpen(true);
                      }}
                      className="w-full text-xs h-7 gap-1"
                    >
                      <BookOpen className="h-3 w-3" />
                      Read Full SOP
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══════════════════════════════════════════════════════════════════════
          COMBINED MULTI-FILE UPLOAD & LIVE PREVIEW MODAL
          ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Upload className="h-4.5 w-4.5 text-purple-600" />
              Add Standard Operating Procedures (SOP)
            </DialogTitle>
          </DialogHeader>

          {/* Mode Switch: Multi-File Upload vs Manual Text Entry */}
          <div className="flex gap-2 border-b pb-2">
            <button
              type="button"
              onClick={() => setUploadModalTab("file")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                uploadModalTab === "file"
                  ? "bg-purple-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <FileUp className="h-3.5 w-3.5" />
              Upload Files (.docx, .pdf, .txt, .md)
            </button>
            <button
              type="button"
              onClick={() => setUploadModalTab("manual")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                uploadModalTab === "manual"
                  ? "bg-purple-600 text-white"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <FileCode className="h-3.5 w-3.5" />
              Write / Paste SOP Text
            </button>
          </div>

          {formError && (
            <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-md font-medium whitespace-pre-line">
              {formError}
            </p>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 1: MULTI-FILE DRAG & DROP UPLOAD
              ══════════════════════════════════════════════════════════════════ */}
          {uploadModalTab === "file" && (
            <div className="space-y-4 py-1">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragOver(true);
                }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  if (e.dataTransfer.files) {
                    handleFilesAdded(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 border-2 border-dashed rounded-xl text-center cursor-pointer transition-all ${
                  isDragOver
                    ? "border-purple-600 bg-purple-50/50 dark:bg-purple-950/20"
                    : "border-muted-foreground/30 hover:border-purple-500 hover:bg-muted/20 bg-muted/10"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".docx,.doc,.pdf,.txt,.md,.markdown"
                  onChange={(e) => {
                    if (e.target.files) {
                      handleFilesAdded(e.target.files);
                      e.target.value = ""; // Reset input so user can add more files
                    }
                  }}
                  className="hidden"
                />

                <div className="flex flex-col items-center gap-2">
                  <div className="h-10 w-10 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-600 flex items-center justify-center">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground">
                      Click to choose files, or drag & drop multiple files here
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Supports Word (<strong>.docx</strong>), <strong>.pdf</strong>, <strong>.md</strong>, <strong>.txt</strong>
                    </p>
                  </div>
                </div>
              </div>

              {/* Staged Files List (Review & Remove Wrongly Uploaded Files) */}
              {stagedFiles.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-purple-600" />
                      Files Staged for Upload ({stagedFiles.length})
                    </span>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-7 text-xs text-purple-600 hover:text-purple-700 gap-1 px-2"
                      >
                        <Plus className="h-3 w-3" />
                        Add More
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setStagedFiles([])}
                        className="h-7 text-xs text-muted-foreground hover:text-destructive gap-1 px-2"
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>

                  {/* List of Files with inspection, editing, and delete controls */}
                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto pr-1">
                    {stagedFiles.map((item, index) => (
                      <div
                        key={item.id}
                        className="p-3 border rounded-xl bg-card space-y-2.5 shadow-2xs group hover:border-border transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 flex-1 min-w-0">
                            <span className="text-xs font-mono font-bold text-muted-foreground w-5 shrink-0 text-center">
                              #{index + 1}
                            </span>

                            <div className="p-2 rounded-lg bg-muted/60 text-purple-600 shrink-0">
                              {item.file.name.endsWith(".docx") ? (
                                <FileText className="h-4 w-4" />
                              ) : item.file.name.endsWith(".pdf") ? (
                                <BookOpen className="h-4 w-4" />
                              ) : (
                                <FileCode className="h-4 w-4" />
                              )}
                            </div>

                            {/* Editable Title and Meta */}
                            <div className="space-y-1 flex-1 min-w-0">
                              <Input
                                value={item.title}
                                onChange={(e) => updateStagedTitle(item.id, e.target.value)}
                                placeholder="Document Title"
                                className="h-7 text-xs font-semibold"
                              />
                              <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                                <span className="truncate max-w-[140px]" title={item.file.name}>
                                  {item.file.name}
                                </span>
                                <span>•</span>
                                <span>{(item.file.size / 1024).toFixed(1)} KB</span>
                                <span>•</span>
                                {item.status === "extracting" ? (
                                  <span className="text-amber-600 flex items-center gap-1 font-medium">
                                    <RefreshCw className="h-2.5 w-2.5 animate-spin" /> Extracting…
                                  </span>
                                ) : item.wordCount > 0 ? (
                                  <span className="text-emerald-600 font-medium">
                                    ✓ {item.wordCount} words extracted
                                  </span>
                                ) : (
                                  <span className="text-purple-600 font-medium">Text ready</span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons: Preview Extracted Text, Category & Remove */}
                          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                            {/* 👁️ View / Inspect Extracted Text Button */}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setInspectingFileId(item.id)}
                              className="h-7 text-xs gap-1 px-2.5 text-purple-600 hover:text-purple-700 hover:bg-purple-50 dark:hover:bg-purple-950/40 border-purple-200 dark:border-purple-800"
                              title="Inspect full extracted text content"
                            >
                              <Eye className="h-3.5 w-3.5" />
                              <span className="hidden xs:inline">View Text</span>
                            </Button>

                            {/* Expand Inline Button */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleExpandStagedFile(item.id)}
                              className="h-7 px-1.5 text-xs text-muted-foreground hover:text-foreground"
                              title={item.isExpanded ? "Collapse inline preview" : "Expand inline preview"}
                            >
                              {item.isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </Button>

                            <select
                              value={item.category}
                              onChange={(e) => updateStagedCategory(item.id, e.target.value)}
                              className="h-7 rounded-md border border-input bg-background px-2 py-0.5 text-xs shadow-2xs focus:outline-none focus:ring-1 focus:ring-ring"
                            >
                              {DOC_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>

                            {/* 🗑️ Remove Button (Remove wrongly uploaded files) */}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeStagedFile(item.id)}
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                              title="Remove this file"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Expandable Inline Extracted Text Box */}
                        {item.isExpanded && (
                          <div className="pt-2 border-t space-y-1.5 animate-in fade-in">
                            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                              <span className="font-semibold text-foreground">Extracted Document Text:</span>
                              <span className="font-mono">{item.wordCount} words ({item.content.length} characters)</span>
                            </div>
                            <textarea
                              rows={4}
                              value={item.content}
                              onChange={(e) => updateStagedContent(item.id, e.target.value)}
                              placeholder="Extracted text preview..."
                              className="w-full rounded-md border border-input bg-muted/20 p-2.5 text-xs leading-relaxed font-mono shadow-2xs focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Batch Upload Progress Indicator */}
              {uploadProgress && (
                <div className="p-3 bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-xl space-y-1.5 text-xs text-purple-900 dark:text-purple-200">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-2">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin text-purple-600" />
                      Uploading {uploadProgress.current} of {uploadProgress.total} documents...
                    </span>
                    <span>{Math.round((uploadProgress.current / uploadProgress.total) * 100)}%</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground truncate font-mono">
                    {uploadProgress.currentName}
                  </p>
                </div>
              )}

              <DialogFooter className="border-t pt-3 flex flex-row items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {stagedFiles.length > 0
                    ? `${stagedFiles.length} file(s) ready`
                    : "No files staged"}
                </span>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setUploadModalOpen(false)}
                    disabled={uploadingBatch}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleBatchUpload}
                    disabled={uploadingBatch || stagedFiles.length === 0}
                    className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
                  >
                    {uploadingBatch ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Saving & Training AI…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Upload {stagedFiles.length > 0 ? `${stagedFiles.length} ` : ""}Document{stagedFiles.length === 1 ? "" : "s"}
                      </>
                    )}
                  </Button>
                </div>
              </DialogFooter>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 2: MANUAL TEXT ENTRY
              ══════════════════════════════════════════════════════════════════ */}
          {uploadModalTab === "manual" && (
            <form onSubmit={handleSaveManualDocument} className="space-y-4 py-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2 space-y-1.5">
                  <Label htmlFor="sop-manual-title">Document Title *</Label>
                  <Input
                    id="sop-manual-title"
                    placeholder="e.g. Sony Camera Setup & Battery SOP"
                    value={manualTitle}
                    onChange={(e) => setManualTitle(e.target.value)}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="sop-manual-cat">Category</Label>
                  <select
                    id="sop-manual-cat"
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value)}
                    className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {DOC_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="sop-manual-content">SOP Content & Instructions *</Label>
                  {manualContent && (
                    <span className="text-[11px] text-muted-foreground font-mono">
                      {manualContent.split(/\s+/).filter(Boolean).length} words
                    </span>
                  )}
                </div>

                <textarea
                  id="sop-manual-content"
                  rows={8}
                  placeholder="Type or paste SOP guidelines, equipment safety rules, and step-by-step instructions here..."
                  value={manualContent}
                  onChange={(e) => setManualContent(e.target.value)}
                  className="w-full rounded-md border border-input bg-background p-3 text-xs leading-relaxed font-sans shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              </div>

              <DialogFooter className="border-t pt-3">
                <Button type="button" variant="outline" onClick={() => setUploadModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={savingManual || !manualTitle.trim() || !manualContent.trim()}
                  className="bg-purple-600 hover:bg-purple-700 text-white"
                >
                  {savingManual ? "Saving & Training AI…" : "Save SOP to Database"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ══════════════════════════════════════════════════════════════════════
          INSPECT EXTRACTED TEXT MODAL (Preview & Edit Staged Text)
          ══════════════════════════════════════════════════════════════════════ */}
      {inspectingFile && (
        <Dialog open={Boolean(inspectingFileId)} onOpenChange={(open) => !open && setInspectingFileId(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto w-[90vw]">
            <DialogHeader>
              <div className="flex items-center justify-between gap-2 pr-6">
                <DialogTitle className="flex items-center gap-2 text-base font-bold">
                  <Eye className="h-4.5 w-4.5 text-purple-600" />
                  Extracted Text Content
                </DialogTitle>
                <Badge variant="outline" className="text-xs bg-muted/40">
                  {inspectingFile.category}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-muted-foreground">
                Review and adjust the extracted text for <span className="font-semibold text-foreground">{inspectingFile.file.name}</span> before confirming upload.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="inspect-title" className="text-xs font-semibold">Document Title</Label>
                <Input
                  id="inspect-title"
                  value={inspectingFile.title}
                  onChange={(e) => updateStagedTitle(inspectingFile.id, e.target.value)}
                  className="text-xs font-semibold h-8"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <Label htmlFor="inspect-content" className="font-semibold">Extracted Text Preview / Editor</Label>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {inspectingFile.wordCount} words ({inspectingFile.content.length} characters)
                  </span>
                </div>
                <textarea
                  id="inspect-content"
                  rows={12}
                  value={inspectingFile.content}
                  onChange={(e) => updateStagedContent(inspectingFile.id, e.target.value)}
                  placeholder="Extracted document text..."
                  className="w-full rounded-md border border-input bg-background p-3 text-xs leading-relaxed font-mono shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <DialogFooter className="border-t pt-3">
              <Button
                type="button"
                className="bg-purple-600 hover:bg-purple-700 text-white"
                onClick={() => setInspectingFileId(null)}
              >
                Done Reviewing
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SOP PREVIEW & CITATION MODAL
          ══════════════════════════════════════════════════════════════════════ */}
      <SOPPreviewModal
        document={previewDoc}
        citation={previewCitation}
        open={previewOpen}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewDoc(null);
          setPreviewCitation(null);
        }}
      />
    </div>
  );
}
