import "server-only";
import { Resend } from "resend";

let client: Resend | null = null;

function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

/**
 * Sends a single email via Resend. Silently no-ops (with a console warning)
 * if RESEND_API_KEY isn't configured, so local development without an
 * email provider set up doesn't crash notification flows — email is an
 * enhancement on top of in-app notifications, never the only channel.
 */
export async function sendEmail(params: {
  to: string;
  subject: string;
  react: React.ReactElement;
}): Promise<void> {
  const resend = getClient();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipped "${params.subject}" to ${params.to}`);
    return;
  }

  const from = process.env.EMAIL_FROM ?? "MaliHub Kenya <notifications@malihub.co.ke>";

  try {
    await resend.emails.send({ from, to: params.to, subject: params.subject, react: params.react });
  } catch (error) {
    console.error(`[email] Failed to send "${params.subject}" to ${params.to}`, error);
  }
}
