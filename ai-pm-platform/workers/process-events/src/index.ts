import type { QueuedEvent } from "@ai-pm-platform/core";
import { processMessage, type ProcessConfig } from "./event-processing.ts";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Exponential backoff, explicit per task 3.3b's Check ("do not accept
// silent defaults") -- there is no static config field for this (verified
// against wrangler's own config-schema.json before writing this;
// max_batch_size/max_retries are the only static retry knobs, see
// wrangler.jsonc). Cloudflare Queues wants delaySeconds <= 43200 (12h);
// capped well under that.
function backoffSeconds(attempts: number): number {
  return Math.min(30 * 2 ** (attempts - 1), 900); // 30s, 60s, 120s, ... capped at 15m
}

export default {
  async queue(batch: MessageBatch<QueuedEvent>, env: Env): Promise<void> {
    const config: ProcessConfig = {
      supabaseUrl: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
    };

    // Per-message try/catch + explicit ack()/retry(), not a bare
    // `for` loop that lets one throw bubble up -- an uncaught error in a
    // Queue consumer retries the WHOLE BATCH, which would mean one
    // malformed message crash-looping every other message alongside it.
    // Task 3.3b's own "Done when" wording is specifically about a single
    // message retrying on its own policy, not the batch.
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, config);
        message.ack();
      } catch (e) {
        console.error(
          `process-events: message ${message.id} failed (attempt ${message.attempts}):`,
          e,
        );
        message.retry({ delaySeconds: backoffSeconds(message.attempts) });
      }
    }
  },
};
