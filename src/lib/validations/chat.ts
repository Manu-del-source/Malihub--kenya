import { z } from "zod";

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_MESSAGE_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
export const ALLOWED_MESSAGE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Strips characters that have no legitimate purpose in a chat message and
 * are common in injection/control-character abuse (null bytes, most other
 * C0 control codes). This is defense-in-depth, not the primary XSS
 * defense — messages are always rendered as plain text through React's
 * default JSX escaping (`{message.content}`), never as raw/dangerouslySet
 * HTML, so script injection isn't reachable through this field regardless.
 */
function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

export const sendMessageSchema = z
  .object({
    chatId: z.string().uuid(),
    content: z
      .string()
      .trim()
      .max(MAX_MESSAGE_LENGTH, `Messages must be under ${MAX_MESSAGE_LENGTH} characters`)
      .transform(stripControlCharacters)
      .optional(),
    imageUrl: z.string().url().optional(),
  })
  .refine((data) => !!data.content || !!data.imageUrl, {
    message: "Message can't be empty",
    path: ["content"],
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  messageId: z.string().uuid(),
  content: z
    .string()
    .trim()
    .min(1, "Message can't be empty")
    .max(MAX_MESSAGE_LENGTH)
    .transform(stripControlCharacters),
});

export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const startChatSchema = z.object({
  sellerId: z.string().uuid(),
  productId: z.string().uuid().optional(),
});

export type StartChatInput = z.infer<typeof startChatSchema>;
