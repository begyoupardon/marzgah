export type SendResult =
  | { ok: true }
  | {
      ok: false
      /** Do not retry (blocked bot, deleted chat). */
      permanent?: boolean
      /** The recipient revoked the bot; the link should be removed. */
      unlink?: boolean
      retryAfterMs?: number
      error: string
    }

/** Delivery port. Implementations must never throw or leak credentials. */
export interface Notifier {
  send: (chatId: string, text: string) => Promise<SendResult>
}
