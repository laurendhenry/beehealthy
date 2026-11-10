/**
 * When the Swaps tab re-checks for background-generated swaps. Generation
 * runs in a scheduled backend worker a few minutes after a receipt is
 * confirmed, so an empty list with `generating: true` is polled — only while
 * the tab is focused, and never for longer than the window.
 */

export const SWAP_POLL_INTERVAL_MS = 30_000;
export const SWAP_POLL_WINDOW_MS = 10 * 60_000;

export function shouldPollSwaps(input: {
  focused: boolean;
  generating: boolean;
  suggestedCount: number;
  /** When polling for this generating stretch began; null when not started. */
  startedAt: number | null;
  now: number;
}): boolean {
  return (
    input.focused &&
    input.generating &&
    input.suggestedCount === 0 &&
    input.startedAt !== null &&
    input.now - input.startedAt < SWAP_POLL_WINDOW_MS
  );
}
