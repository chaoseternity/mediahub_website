import { z } from "zod";

const ChatRequestSchema = z
  .object({
    question: z.string().optional(),
    message: z.string().optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })
      )
      .optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.question && data.question.trim().length > 0) ||
        (data.message && data.message.trim().length > 0)
      ),
    {
      message: "Please provide a question or message.",
    }
  );

describe("SOP Chat Request Validation", () => {
  test("accepts payload with 'message' field", () => {
    const payload = {
      message: "What is the return policy?",
      history: [{ role: "user", content: "Hello" }],
    };
    const result = ChatRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      const q = (result.data.question || result.data.message || "").trim();
      expect(q).toBe("What is the return policy?");
    }
  });

  test("accepts payload with 'question' field", () => {
    const payload = {
      question: "Where are the cameras stored?",
    };
    const result = ChatRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      const q = (result.data.question || result.data.message || "").trim();
      expect(q).toBe("Where are the cameras stored?");
    }
  });

  test("accepts payload with both 'question' and 'message'", () => {
    const payload = {
      question: "Sony FX3 weight?",
      message: "Sony FX3 weight?",
    };
    const result = ChatRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  test("rejects empty question and message", () => {
    const payload = {
      question: "   ",
      message: "",
    };
    const result = ChatRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Please provide a question or message.");
    }
  });

  test("rejects payload missing both question and message", () => {
    const payload = {
      history: [],
    };
    const result = ChatRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });
});

const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn((options: any) => ({
  generateContent: mockGenerateContent,
}));

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: (opts: any) => mockGetGenerativeModel(opts),
  })),
}));

describe("askSOPAssistant with SOP & Web Fallback", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-api-key" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("returns SOP answer with citations when SOP contains the answer", async () => {
    const { askSOPAssistant } = await import("@/lib/gemini");
    const fakeSopResponse = `To return damaged equipment, please notify the In-Charge immediately and log the damage report in the inventory system.

\`\`\`json_citations
[
  {
    "document_id": 101,
    "document_title": "Damage & Return SOP",
    "section_title": "Damaged Items",
    "snippet": "Notify the In-Charge immediately upon identifying any equipment fault."
  }
]
\`\`\``;

    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => fakeSopResponse,
      },
    });

    const res = await askSOPAssistant({
      question: "What is the procedure for damaged equipment?",
      sopDocuments: [
        {
          id: 101,
          title: "Damage & Return SOP",
          category: "General",
          content: "Notify the In-Charge immediately upon identifying any equipment fault.",
          file_name: "damage_sop.pdf",
          file_type: "application/pdf",
          file_size: 1024,
          uploaded_by: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    });

    expect(res.answer).toContain("To return damaged equipment");
    expect(res.citations).toHaveLength(1);
    expect(res.citations[0].document_title).toBe("Damage & Return SOP");
    expect(res.citations[0].document_id).toBe(101);
  });

  test("returns clearly distinguished web fallback when question is not found in SOPs", async () => {
    const { askSOPAssistant } = await import("@/lib/gemini");
    const fakeWebResponse = `> ⚠️ **Not in Official SOPs**: The uploaded SOP documents do not contain information regarding this topic. The following information is retrieved from the web:

### 🌐 From Web / External Sources
The Sony FX3 weighs approximately 715g (1 lb 9.3 oz) including battery and memory card.

*Note: This information is sourced from the web and does not represent official MediaHub club policy.*

\`\`\`json_citations
[]
\`\`\``;

    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => fakeWebResponse,
      },
    });

    const res = await askSOPAssistant({
      question: "How heavy is the Sony FX3?",
      sopDocuments: [],
    });

    expect(res.answer).toContain("Not in Official SOPs");
    expect(res.answer).toContain("From Web / External Sources");
    expect(res.answer).toContain("715g");
    expect(res.citations).toHaveLength(0);
  });

  test("falls back to standard model call if googleSearch tool is unsupported", async () => {
    const { askSOPAssistant } = await import("@/lib/gemini");

    // First attempt with tool throws unsupported error
    mockGenerateContent.mockRejectedValueOnce(new Error("Search tool is not supported for this model"));
    // Second attempt without tool succeeds
    mockGenerateContent.mockResolvedValueOnce({
      response: {
        text: () => "### 🌐 From Web / External Sources\nFallback answer from model knowledge.",
      },
    });

    const res = await askSOPAssistant({
      question: "Explain shutter angle vs shutter speed",
      sopDocuments: [],
    });

    expect(res.answer).toContain("Fallback answer from model knowledge");
  });
});

