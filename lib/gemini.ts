import { GoogleGenerativeAI } from "@google/generative-ai";
import type { SOPDocument, SOPCitation } from "./types";

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
}

export interface SOPAnswerResult {
  answer: string;
  citations: SOPCitation[];
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
}: SOPQueryContext): Promise<SOPAnswerResult> {
  const genAI = getGeminiClient();

  if (!sopDocuments || sopDocuments.length === 0) {
    return {
      answer:
        "There are currently no SOP documents uploaded in MediaHub. Please ask an Admin to upload Standard Operating Procedure documents in the SOP Library tab before asking questions.",
      citations: [],
    };
  }

  const relevantDocs = retrieveRelevantDocuments(question, sopDocuments);

  // Build context payload
  const contextText = relevantDocs
    .map(
      (doc) =>
        `=== SOP DOCUMENT [ID: ${doc.id}] ===\nTitle: ${doc.title}\nCategory: ${doc.category}\n${
          doc.file_name ? `File: ${doc.file_name}\n` : ""
        }Content:\n${doc.content}\n=== END DOCUMENT [ID: ${doc.id}] ===`
    )
    .join("\n\n");

  const systemInstruction = `You are the official MediaHub SOP (Standard Operating Procedure) AI Assistant.
Your mission is to provide accurate, helpful, and concise operational instructions to media team members (Photo, Video, Audio/AV, and Event In-Charges) based strictly on the provided SOP documents.

RULES:
1. Grounding: Rely strictly on the information in the provided SOP Documents. Do NOT make up rules or policies not found in the documents.
2. If the answer is not contained in the provided SOPs, state clearly: "I couldn't find specific instructions for this in the uploaded SOPs. Please check with an Admin or Section In-Charge."
3. Formatting: Use structured Markdown with bold key terms, numbered steps for procedures, and bullet points.
4. Source Attribution: At the very end of your response, you MUST output a JSON block of cited sources in the exact format:
\`\`\`json_citations
[
  {
    "document_id": <number>,
    "document_title": "<exact document title>",
    "section_title": "<section heading or topic>",
    "snippet": "<exact 1-2 sentence excerpt from the SOP document that supports this answer>"
  }
]
\`\`\`
Do not omit the \`\`\`json_citations block. Ensure the JSON is valid.`;

  // Use gemini-2.0-flash or gemini-1.5-flash
  const modelName = "gemini-2.0-flash";
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction,
  });

  const prompt = `Here are the official MediaHub SOP Documents for reference:

${contextText}

Previous Conversation History:
${history.map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`).join("\n")}

User Question: ${question}

Please answer the user's question clearly according to the SOP documents and append the \`\`\`json_citations block.`;

  try {
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
          citations = parsed.map((item) => ({
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
    } else {
      // Fallback: If model didn't format json_citations, match top relevant docs
      citations = relevantDocs.slice(0, 2).map((doc) => ({
        document_id: doc.id,
        document_title: doc.title,
        section_title: doc.category,
        snippet: doc.content.slice(0, 200) + "...",
      }));
    }

    return {
      answer: cleanAnswer,
      citations,
    };
  } catch (err: unknown) {
    console.error("Gemini API Error:", err);
    throw new Error(err instanceof Error ? err.message : "Failed to generate AI response from Gemini API");
  }
}
