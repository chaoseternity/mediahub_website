import { z } from "zod";

/** Request body for POST /api/sop/chat (shared with tests). */
export const ChatRequestSchema = z
  .object({
    question: z.string().max(4000, "Question must be 4000 characters or less").optional(),
    message: z.string().max(4000, "Message must be 4000 characters or less").optional(),
    image: z.string().max(7 * 1024 * 1024, "Image must be 7MB or less").optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(4000, "History message must be 4000 characters or less"),
        })
      )
      .max(50, "History cannot exceed 50 messages")
      .optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.question && data.question.trim().length > 0) ||
        (data.message && data.message.trim().length > 0) ||
        Boolean(data.image)
      ),
    {
      message: "Please provide a question or message.",
    }
  );

export type ChatRequest = z.infer<typeof ChatRequestSchema>;
