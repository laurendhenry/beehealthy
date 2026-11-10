import test from "node:test";
import assert from "node:assert/strict";

import { SWAP_POLL_WINDOW_MS, shouldPollSwaps } from "../lib/swap-polling";

const base = {
  focused: true,
  generating: true,
  suggestedCount: 0,
  startedAt: 1_000,
  now: 2_000,
};

test("polls only while focused, generating and still empty", () => {
  assert.equal(shouldPollSwaps(base), true);
  assert.equal(shouldPollSwaps({ ...base, focused: false }), false);
  assert.equal(shouldPollSwaps({ ...base, generating: false }), false);
  assert.equal(shouldPollSwaps({ ...base, suggestedCount: 1 }), false);
  assert.equal(shouldPollSwaps({ ...base, startedAt: null }), false);
});

test("stops polling after the window", () => {
  assert.equal(shouldPollSwaps({ ...base, now: base.startedAt + SWAP_POLL_WINDOW_MS - 1 }), true);
  assert.equal(shouldPollSwaps({ ...base, now: base.startedAt + SWAP_POLL_WINDOW_MS }), false);
});
