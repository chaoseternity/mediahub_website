"use client";

import { useState, useRef, useEffect } from "react";
import {
  Bot,
  BookOpen,
  Upload,
  Send,
  Trash2,
  FileText,
  Plus,
  Sparkles,
  Search,
  AlertCircle,
  Clock,
  User,
  ExternalLink,
  RefreshCw,
  FolderOpen,
  FileCode,
  CheckCircle,
  FileUp,
  RotateCcw,
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

const PRESET_QUESTIONS = [
  "What is our procedure for returning damaged equipment?",
  "Which cameras and lenses are currently available in inventory?",
  "What is the mass/weight and specs of a Sony FX3 camera?",
  "Where are our wireless microphone kits stored?",
];

const CATEGORIES = ["All", "General", "Photo", "Video", "Audio/AV", "Safety & Handling", "Events"];

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

  // File Upload state & Live Preview
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docCategory, setDocCategory] = useState("General");
  const [docContent, setDocContent] = useState("");
  const [parsingFile, setParsingFile] = useState(false);
  const [savingDoc, setSavingDoc] = useState(false);
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

  // Handle Client-Side File Extraction
  async function handleFileSelect(file: File) {
    setUploadFile(file);
    setFormError(null);
    setParsingFile(true);

    const baseTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
    if (!docTitle) setDocTitle(baseTitle);

    const nameLower = file.name.toLowerCase();

    try {
      // 1. Microsoft Word (.docx) client extraction via JSZip
      if (nameLower.endsWith(".docx")) {
        const arrayBuffer = await file.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const docXmlFile = zip.file("word/document.xml");

        if (docXmlFile) {
          const xml = await docXmlFile.async("text");
          let clean = xml
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

          setDocContent(clean);
          setParsingFile(false);
          return;
        }
      }

      // 2. Plain Text / Markdown (.txt, .md, .csv)
      if (
        nameLower.endsWith(".txt") ||
        nameLower.endsWith(".md") ||
        nameLower.endsWith(".markdown") ||
        file.type.includes("text")
      ) {
        const text = await file.text();
        setDocContent(text.trim());
        setParsingFile(false);
        return;
      }

      // 3. For PDF or binary documents, send to server
      setDocContent(`[File selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)]\nText will be extracted on the server.`);
    } catch (err: unknown) {
      console.warn("Client parsing fallback:", err);
      setDocContent(`[File selected: ${file.name}]\nText will be extracted on the server.`);
    } finally {
      setParsingFile(false);
    }
  }

  // Handle Save Document (File or Manual)
  async function handleSaveDocument(e: React.FormEvent) {
    e.preventDefault();
    if (!docTitle.trim()) {
      setFormError("Please provide a document title.");
      return;
    }

    setSavingDoc(true);
    setFormError(null);

    try {
      let res: Response;

      if (docContent && !docContent.startsWith("[File selected:")) {
        // Send fast, clean, reliable JSON payload with extracted text
        res = await fetch("/api/sop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: docTitle.trim(),
            category: docCategory,
            content: docContent.trim(),
            file_name: uploadFile?.name ?? null,
            file_type: uploadFile?.type ?? null,
            file_size: uploadFile?.size ?? null,
          }),
        });
      } else if (uploadFile) {
        const formData = new FormData();
        formData.append("file", uploadFile);
        formData.append("title", docTitle.trim());
        formData.append("category", docCategory);

        res = await fetch("/api/sop", {
          method: "POST",
          body: formData,
        });
      } else {
        throw new Error("Please select a file or enter SOP content.");
      }

      let data: any = null;
      let rawText = "";
      try {
        rawText = await res.text();
        if (rawText) data = JSON.parse(rawText);
      } catch {
        // Non-JSON response
      }

      if (!res.ok) {
        const errorMsg =
          (data && (typeof data.error === "string" ? data.error : data.error?.message)) ||
          rawText ||
          `Server error (HTTP ${res.status})`;
        throw new Error(errorMsg);
      }

      // Success
      setUploadModalOpen(false);
      setUploadFile(null);
      setDocTitle("");
      setDocContent("");
      setDocCategory("General");
      refreshDocuments();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to save SOP document.");
    } finally {
      setSavingDoc(false);
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

    const historyPayload = messages
      .filter((m) => m.id !== "welcome")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    try {
      const res = await fetch("/api/sop/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          history: historyPayload,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to get response from AI");
      }

      const botMsg: AIChatMessage = {
        id: `bot-${Date.now()}`,
        role: "assistant",
        content: data.answer,
        citations: data.citations || [],
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, botMsg]);
    } catch (err: unknown) {
      const errorMsg: AIChatMessage = {
        id: `bot-err-${Date.now()}`,
        role: "assistant",
        content: `⚠️ **Error**: ${err instanceof Error ? err.message : "Something went wrong while connecting to the AI Assistant."}`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setChatLoading(false);
    }
  }

  // Open Document Citation
  function handleOpenCitation(citation: SOPCitation) {
    const matched = documents.find((d) => d.id === citation.document_id);
    if (matched) {
      setPreviewDoc(matched);
      setPreviewCitation(citation);
      setPreviewOpen(true);
    } else {
      fetch(`/api/sop/${citation.document_id}`)
        .then((res) => res.json())
        .then((doc) => {
          setPreviewDoc(doc);
          setPreviewCitation(citation);
          setPreviewOpen(true);
        })
        .catch((e) => console.error("Could not fetch cited doc", e));
    }
  }

  // Handle Delete Document
  async function handleDeleteDocument(id: number, title: string) {
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
    try {
      const res = await fetch(`/api/sop/${id}`, { method: "DELETE" });
      if (res.ok) refreshDocuments();
    } catch (e) {
      console.error("Failed to delete SOP document", e);
    }
  }

  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.file_name && doc.file_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === "All" || doc.category.toLowerCase() === selectedCategory.toLowerCase();

    return matchesSearch && matchesCategory;
  });

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
              setDocTitle("");
              setDocContent("");
              setUploadFile(null);
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
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
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
          <div className="border rounded-xl bg-card flex flex-col h-[650px] shadow-sm overflow-hidden">
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
                              <code className="px-1.5 py-0.5 rounded bg-muted/80 text-foreground font-mono text-xs border">{children}</code>
                            ),
                            blockquote: ({ children }) => (
                              <blockquote className="border-l-2 border-purple-500 pl-3 italic my-2 text-muted-foreground">{children}</blockquote>
                            ),
                            table: ({ children }) => (
                              <div className="overflow-x-auto my-2 border rounded-lg">
                                <table className="w-full text-xs text-left">{children}</table>
                              </div>
                            ),
                            thead: ({ children }) => <thead className="bg-muted/60 border-b">{children}</thead>,
                            th: ({ children }) => <th className="px-3 py-2 font-semibold">{children}</th>,
                            td: ({ children }) => <td className="px-3 py-2 border-b border-muted/40">{children}</td>,
                          }}
                        >
                          {m.content}
                        </ReactMarkdown>
                      )}
                    </div>

                    {/* Source Citations Box */}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-border/60 space-y-1.5">
                        <div className="flex items-center gap-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                          <BookOpen className="h-3 w-3" />
                          Verified SOP Sources ({m.citations.length}):
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {m.citations.map((cite, idx) => (
                            <button
                              key={idx}
                              onClick={() => handleOpenCitation(cite)}
                              title={cite.snippet}
                              className="text-left flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-100 hover:bg-purple-200 dark:bg-purple-950/60 dark:hover:bg-purple-900/80 text-purple-950 dark:text-purple-200 border border-purple-300 dark:border-purple-800 text-[11px] font-medium transition-colors group cursor-pointer"
                            >
                              <FileText className="h-3 w-3 text-purple-600 dark:text-purple-400 shrink-0" />
                              <span className="truncate max-w-[200px]">{cite.document_title}</span>
                              <ExternalLink className="h-2.5 w-2.5 opacity-60 group-hover:opacity-100 shrink-0" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {m.role === "user" && (
                    <div className="h-8 w-8 rounded-full bg-primary/20 text-primary flex items-center justify-center shrink-0">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              ))}

              {chatLoading && (
                <div className="flex gap-3 justify-start items-center text-xs text-muted-foreground py-2">
                  <div className="h-8 w-8 rounded-full bg-purple-600 text-white flex items-center justify-center shrink-0 animate-pulse">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <div className="bg-muted/40 border px-3 py-2 rounded-xl flex items-center gap-2">
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-purple-600" />
                    <span>Searching SOP knowledge base & synthesizing answer…</span>
                  </div>
                </div>
              )}

              <div ref={chatBottomRef} />
            </div>

            {/* Quick Suggestion Chips */}
            <div className="px-4 py-2 border-t bg-muted/20 flex gap-2 overflow-x-auto text-xs no-scrollbar">
              <span className="text-muted-foreground font-semibold shrink-0 self-center">Try asking:</span>
              {PRESET_QUESTIONS.map((pq, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(pq)}
                  className="whitespace-nowrap px-2.5 py-1 rounded-full bg-background border hover:border-primary hover:text-primary transition-colors text-[11px]"
                >
                  {pq}
                </button>
              ))}
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="p-3 border-t bg-background flex items-center gap-2"
            >
              <Input
                placeholder="Ask any question about MediaHub SOPs, equipment protocols, or safety rules…"
                value={inputQuery}
                onChange={(e) => setInputQuery(e.target.value)}
                disabled={chatLoading}
                className="flex-1 text-sm h-11"
              />
              <Button
                type="submit"
                disabled={chatLoading || !inputQuery.trim()}
                className="h-11 px-4 bg-purple-600 hover:bg-purple-700 text-white gap-1.5"
              >
                <Send className="h-4 w-4" />
                Ask
              </Button>
            </form>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════════════════════════════════
            TAB 2: SOP LIBRARY & UPLOADS
            ══════════════════════════════════════════════════════════════════════ */}
        <TabsContent value="library" className="space-y-4 pt-2">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search SOP title, content or file name…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 items-center">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-purple-600 text-white"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Document Grid */}
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-16 border rounded-xl bg-muted/10 space-y-3">
              <FolderOpen className="h-12 w-12 text-muted-foreground/40 mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">No SOP documents found</p>
                <p className="text-xs text-muted-foreground">
                  {searchQuery ? "Try adjusting your search query." : "Upload SOP files (.docx, .pdf, .txt, .md) to build the knowledge base."}
                </p>
              </div>
              {isAdmin && (
                <Button onClick={() => setUploadModalOpen(true)} size="sm" className="bg-purple-600 hover:bg-purple-700 text-white gap-1.5 text-xs">
                  <Upload className="h-3.5 w-3.5" />
                  Add First SOP
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="border rounded-xl p-4 bg-card hover:border-purple-500/50 transition-all shadow-xs space-y-3 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 flex items-center justify-center shrink-0">
                          <BookOpen className="h-4 w-4" />
                        </div>
                        <div>
                          <h4 className="font-bold text-sm leading-tight text-foreground">{doc.title}</h4>
                          {doc.file_name && (
                            <span className="text-[11px] text-muted-foreground font-mono truncate block">
                              {doc.file_name}
                            </span>
                          )}
                        </div>
                      </div>

                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        {doc.category}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">
                      {doc.content.replace(/[#*`]/g, "").slice(0, 180)}...
                    </p>
                  </div>

                  <div className="flex items-center justify-between border-t pt-3 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(doc.updated_at).toLocaleDateString("en-GB")}
                    </span>

                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setPreviewDoc(doc);
                          setPreviewCitation(null);
                          setPreviewOpen(true);
                        }}
                        className="h-7 text-xs gap-1"
                      >
                        <FileText className="h-3 w-3 text-primary" />
                        View Full SOP
                      </Button>

                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDeleteDocument(doc.id, doc.title)}
                          className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* ══════════════════════════════════════════════════════════════════════
          COMBINED SOP UPLOAD & LIVE PREVIEW MODAL
          ══════════════════════════════════════════════════════════════════════ */}
      <Dialog open={uploadModalOpen} onOpenChange={setUploadModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto w-[95vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <Upload className="h-4.5 w-4.5 text-purple-600" />
              Add Standard Operating Procedure (SOP)
            </DialogTitle>
          </DialogHeader>

          {/* Mode Switch: File Upload vs Manual Entry */}
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
              Upload Document (.docx, .pdf, .txt, .md)
            </button>
            <button
              type="button"
              onClick={() => {
                setUploadModalTab("manual");
                setUploadFile(null);
              }}
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

          <form onSubmit={handleSaveDocument} className="space-y-4 py-2">
            {formError && (
              <p className="text-xs text-destructive bg-destructive/10 p-2.5 rounded-md font-medium">
                {formError}
              </p>
            )}

            {/* File Picker Zone */}
            {uploadModalTab === "file" && (
              <div className="space-y-1.5">
                <Label htmlFor="upload-file-input">Select Word, PDF, or Text File *</Label>
                <Input
                  id="upload-file-input"
                  type="file"
                  accept=".docx,.doc,.pdf,.txt,.md,.markdown"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                  required={!uploadFile && !docContent}
                />
                <p className="text-[11px] text-muted-foreground">
                  Supported formats: <strong>.docx (Word)</strong>, <strong>.pdf</strong>, <strong>.md (Markdown)</strong>, <strong>.txt</strong>
                </p>
              </div>
            )}

            {/* Document Title & Category */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1.5">
                <Label htmlFor="sop-doc-title">Document Title *</Label>
                <Input
                  id="sop-doc-title"
                  placeholder="e.g. Sony Camera Setup & Battery SOP"
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sop-doc-cat">Category</Label>
                <select
                  id="sop-doc-cat"
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value)}
                  className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="General">General</option>
                  <option value="Photo">Photo</option>
                  <option value="Video">Video</option>
                  <option value="Audio/AV">Audio/AV</option>
                  <option value="Safety & Handling">Safety & Handling</option>
                  <option value="Events">Events</option>
                </select>
              </div>
            </div>

            {/* Content & Live Preview Box */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="sop-doc-content">
                  {uploadModalTab === "file" ? "Extracted Text Preview" : "SOP Content & Instructions *"}
                </Label>
                {docContent && (
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {docContent.split(/\s+/).filter(Boolean).length} words ({docContent.length} characters)
                  </span>
                )}
              </div>

              {parsingFile ? (
                <div className="p-8 border border-dashed rounded-lg text-center text-xs text-muted-foreground flex items-center justify-center gap-2 bg-muted/20">
                  <RefreshCw className="h-4 w-4 animate-spin text-purple-600" />
                  <span>Extracting document text…</span>
                </div>
              ) : (
                <textarea
                  id="sop-doc-content"
                  rows={8}
                  placeholder={
                    uploadModalTab === "file"
                      ? "Select a file above to view extracted text here..."
                      : "Type or paste SOP guidelines, equipment safety rules, and step-by-step instructions here..."
                  }
                  value={docContent}
                  onChange={(e) => setDocContent(e.target.value)}
                  className="w-full rounded-md border border-input bg-background p-3 text-xs leading-relaxed font-sans shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  required
                />
              )}
            </div>

            <DialogFooter className="border-t pt-3">
              <Button type="button" variant="outline" onClick={() => setUploadModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={savingDoc || parsingFile || !docTitle.trim() || !docContent.trim()}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                {savingDoc ? "Saving & Training AI…" : "Save SOP to Database"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
