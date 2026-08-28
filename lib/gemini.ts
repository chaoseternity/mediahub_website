import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SOPDocument, SOPCitation, Equipment, AppEvent } from "./types";

function getGeminiClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not configured.");
  }
  return new GoogleGenerativeAI(apiKey);
}

export interface SOPQueryContext {
  question: string;
  history?: { role: "user" | "assistant"; content: string }[];
  sopDocuments: SOPDocument[];
  equipmentList?: Equipment[];
  events?: AppEvent[];
}

export interface SOPAnswerResult {
  answer: string;
  citations: SOPCitation[];
  modelUsed?: string;
}

/**
 * Searches and selects the most relevant SOP document chunks for a question.
 */
function retrieveRelevantDocuments(question: string, docs: SOPDocument[]): SOPDocument[] {
  if (docs.length <= 8) {
    return docs;
  }

  const queryTerms = question
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const scored = docs.map((doc) => {
    let score = 0;
    const titleLower = doc.title.toLowerCase();
    const catLower = doc.category.toLowerCase();
    const contentLower = doc.content.toLowerCase();

    for (const term of queryTerms) {
      if (titleLower.includes(term)) score += 10;
      if (catLower.includes(term)) score += 5;
      const count = (contentLower.match(new RegExp(term, "g")) || []).length;
      score += Math.min(count, 15);
    }

    return { doc, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((s) => s.doc);
}

export async function askSOPAssistant({
  question,
  history = [],
  sopDocuments,
  equipmentList = [],
  events = [],
}: SOPQueryContext): Promise<SOPAnswerResult> {
  const genAI = getGeminiClient();

  const relevantDocs = retrieveRelevantDocuments(question, sopDocuments);

  // 1. Build SOP Context
  let sopContextText = "";
  if (relevantDocs.length > 0) {
    sopContextText = relevantDocs
      .map(
        (doc) =>
          `=== SOP DOCUMENT [ID: ${doc.id}] ===\nTitle: ${doc.title}\nCategory: ${doc.category}\n${
            doc.file_name ? `File: ${doc.file_name}\n` : ""
          }Content:\n${doc.content}\n=== END DOCUMENT [ID: ${doc.id}] ===`
      )
      .join("\n\n");
  } else {
    sopContextText = "No official SOP documents uploaded yet.";
  }

  // 2. Build Live Equipment Inventory Context
  let inventoryContextText = "";
  if (equipmentList.length > 0) {
    inventoryContextText = equipmentList
      .map((item) => {
        let statusText: string = item.status;
        if (item.status === "Checked Out" && item.checked_out_by_name) {
          statusText = `Checked Out by ${item.checked_out_by_name}${
            item.expected_return_at ? ` (Expected Return: ${item.expected_return_at})` : ""
          }${item.checkout_location ? ` at ${item.checkout_location}` : ""}`;
        } else if (item.status.startsWith("In Event") && item.active_event_name) {
          statusText = `${item.status} ("${item.active_event_name}" @ ${item.active_event_location || "Event Venue"})`;
        }

        return `• [ID: ${item.id}] ${item.name} | Status: ${statusText} | Location: ${item.location} | Condition: ${item.condition}${
          item.serial_number ? ` | S/N: ${item.serial_number}` : ""
        }${item.tags && item.tags.length > 0 ? ` | Tags: ${item.tags.join(", ")}` : ""}${
          item.description ? ` | Desc: ${item.description}` : ""
        }`;
      })
      .join("\n");
  } else {
    inventoryContextText = "No equipment currently registered in inventory.";
  }

  // 3. Build Upcoming Events Context
  let eventsContextText = "";
  if (events.length > 0) {
    eventsContextText = events
      .slice(0, 10)
      .map(
        (ev) =>
          `• [Event #${ev.id}] "${ev.name}" | Location: ${ev.location} | Time: ${new Date(
            ev.start_time
          ).toLocaleString("en-GB")} to ${new Date(ev.end_time).toLocaleString("en-GB")}${
            ev.has_rehearsal ? " (Includes Rehearsal)" : ""
          }`
      )
      .join("\n");
  } else {
    eventsContextText = "No upcoming events scheduled.";
  }

  const systemInstruction = `You are the official MediaHub AI Assistant — an intelligent operations partner for media production teams (Photo, Video, Audio/AV, and Event In-Charges).

YOU HAVE 3 CORE CAPABILITIES:
1. Standard Operating Procedures (SOP): Answer guidelines, rules, checklists, and handling procedures based on the provided SOP Documents. When referencing SOPs, always append the source citations JSON block.
2. Live Equipment Inventory & Availability: Answer real-time questions about equipment status (Available, Checked Out, In Event, Maintenance), storage locations, who has items checked out, and upcoming event allocations based on the Live Inventory Data.
3. Technical Specifications & Web Knowledge: Answer questions regarding technical camera/lens specs, mass/weight (e.g. Sony FX3 mass, lens mounts, sensor specs), audio settings, best practices, and equipment comparisons using comprehensive technical and web knowledge.

FORMATTING & CITATION RULES:
• Formatting: Use structured Markdown with bold keywords, numbered steps for procedures, and tables when listing or comparing items.
• Tone: Professional, clear, concise, and helpful.
• Source Attribution: If and only if your answer references specific uploaded SOP Documents, append a json_citations block at the very end in this exact format:
\`\`\`json_citations
[
  {
    "document_id": <number>,
    "document_title": "<exact document title>",
    "section_title": "<section heading or topic>",
    "snippet": "<exact 1-2 sentence excerpt from the SOP document>"
  }
]
\`\`\`
If answering purely about live inventory availability, technical gear specs, or general knowledge, you may omit or output an empty \`\`\`json_citations []\`\`\` block.`;

  const prompt = `=== SYSTEM DATA & KNOWLEDGE BASE ===

[1. LIVE MEDIAHUB INVENTORY & EQUIPMENT STATUS]
${inventoryContextText}

[2. UPCOMING EVENTS & SCHEDULE]
${eventsContextText}

[3. OFFICIAL STANDARD OPERATING PROCEDURES (SOP)]
${sopContextText}

=== CONVERSATION HISTORY ===
${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n")}

User Question: ${question}

Please answer the user's question clearly and accurately using the appropriate knowledge source (Live Inventory, SOPs, or Technical/Web specs).`;

  // Model fallback hierarchy
  const modelsToTry = [
    process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
    process.env.GEMINI_BACKUP_MODEL || "gemini-3.1-flash-lite",
    "gemini-3.7-flash",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-3-flash",
    "gemini-3.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
  ];

  const uniqueModels = Array.from(new Set(modelsToTry));
  let lastError: unknown = null;

  for (const modelName of uniqueModels) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction,
      });

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Parse out json_citations block
      let cleanAnswer = responseText;
      let citations: SOPCitation[] = [];

      const citationMatch = responseText.match(/```json_citations\s*([\s\S]*?)\s*```/);
      if (citationMatch && citationMatch[1]) {
        try {
          const parsed = JSON.parse(citationMatch[1]);
          if (Array.isArray(parsed)) {
            citations = parsed
              .filter((item) => item && item.document_id)
              .map((item) => ({
                document_id: Number(item.document_id) || relevantDocs[0]?.id || 0,
                document_title: String(item.document_title || "SOP Document"),
                section_title: item.section_title ? String(item.section_title) : undefined,
                snippet: String(item.snippet || ""),
              }));
          }
        } catch (e) {
          console.warn("Could not parse json_citations block:", e);
        }
        cleanAnswer = responseText.replace(/```json_citations\s*[\s\S]*?\s*```/, "").trim();
      }

      return {
        answer: cleanAnswer,
        citations,
        modelUsed: modelName,
      };
    } catch (err: unknown) {
      console.warn(`Model ${modelName} failed, attempting next model:`, err);
      lastError = err;
    }
  }

  console.error("All Gemini models in chain failed:", lastError);
  throw new Error(
    lastError instanceof Error
      ? lastError.message
      : "Failed to generate AI response from Gemini API models."
  );
}
