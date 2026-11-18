/**
 * Merge saved messages and conversation system events into one timeline.
 * Previous versions rendered the two collections separately, which caused
 * nudges and Winks to remain below newer messages regardless of their time.
 * This helper is deliberately independent of React, Supabase, and Tauri.
 */
export type TimestampedEntry = { id: string; created_at: string };

export type ConversationTimelineEntry<
  TMessage extends TimestampedEntry,
  TEvent extends TimestampedEntry,
> =
  | { kind: 'message'; entry: TMessage }
  | { kind: 'event'; entry: TEvent };

export function mergeConversationTimeline<
  TMessage extends TimestampedEntry,
  TEvent extends TimestampedEntry,
>(
  messages: readonly TMessage[],
  events: readonly TEvent[],
): ConversationTimelineEntry<TMessage, TEvent>[] {
  const combined: ConversationTimelineEntry<TMessage, TEvent>[] = [
    ...messages.map(entry => ({ kind: 'message' as const, entry })),
    ...events.map(entry => ({ kind: 'event' as const, entry })),
  ];

  return combined.sort((left, right) => {
    const a = Date.parse(left.entry.created_at);
    const b = Date.parse(right.entry.created_at);
    if (Number.isFinite(a) && Number.isFinite(b) && a !== b) return a - b;
    // PostgreSQL timestamps may have microsecond precision, while JS Date
    // parses only milliseconds. Preserve the original sub-ms ordering.
    const byText = left.entry.created_at.localeCompare(right.entry.created_at);
    if (byText !== 0) return byText;
    // Stable tie-breaker for entries with identical timestamps.
    return `${left.kind}:${left.entry.id}`.localeCompare(`${right.kind}:${right.entry.id}`);
  });
}
