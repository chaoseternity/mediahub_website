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
