import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { isAccountSwitch, isSessionExpired, toAuthSession, toISODateString, type AuthSession } from "../types/api";

function session(userId: string, expiresAt: string): AuthSession {
  return {
    user: { id: userId, name: "Test", email: "t@test.dev", image: null },
    session: { id: "s1", expiresAt },
  };
}

describe("auth: session expiry", () => {
  const now = Date.parse("2026-10-20T12:00:00.000Z");

  it("treats missing or malformed sessions as expired (never trust stale state)", () => {
    assert.equal(isSessionExpired(null, now), true);
    assert.equal(
      isSessionExpired(session("u1", "not-a-date"), now),
      true,
    );
  });

  it("treats a live session as valid", () => {
    assert.equal(
      isSessionExpired(session("u1", "2026-10-20T13:00:00.000Z"), now),
      false,
    );
  });

  it("treats a past expiresAt as expired", () => {
    assert.equal(
      isSessionExpired(session("u1", "2026-10-20T11:00:00.000Z"), now),
      true,
    );
  });

  it("applies a 30s clock-skew margin before forcing revalidation", () => {
    // Expires 10s in the future: within the margin → expired.
    assert.equal(
      isSessionExpired(session("u1", "2026-10-20T12:00:10.000Z"), now),
      true,
    );
    // Expires 60s in the future: outside the margin → valid.
    assert.equal(
      isSessionExpired(session("u1", "2026-10-20T12:01:00.000Z"), now),
      false,
    );
  });
});

describe("auth: logout / account-switch invalidation", () => {
  const live = "2026-10-20T13:00:00.000Z";

  it("detects logout (session → null) so account state can be cleared", () => {
    assert.equal(isAccountSwitch(session("u1", live), null), true);
  });

  it("detects account switch (user A → user B)", () => {
    assert.equal(isAccountSwitch(session("u1", live), session("u2", live)), true);
  });

  it("does not invalidate on first login (null → session)", () => {
    assert.equal(isAccountSwitch(null, session("u1", live)), false);
  });

  it("does not invalidate when the same account revalidates", () => {
    assert.equal(isAccountSwitch(session("u1", live), session("u1", live)), false);
    assert.equal(isAccountSwitch(null, null), false);
  });

  it("does not invalidate on session refresh for the same account", () => {
    const before = session("u1", live);
    const after: AuthSession = {
      user: before.user,
      session: { id: "s2", expiresAt: live },
    };
    assert.equal(isAccountSwitch(before, after), false);
  });
});

describe("auth: better-auth date revival (native get-session payload)", () => {
  // better-auth's client JSON parser revives every ISO-8601 string into a
  // `Date` before our code sees it. Raw DevTools bodies show strings, but
  // `authClient.getSession()` resolves with `Date` objects. Regression test
  // for the stuck-on-login bug: `toAuthSession` used to reject those.
  const revivedPayload = {
    session: {
      expiresAt: new Date("2026-10-27T01:57:42.867Z"),
      token: "tok",
      createdAt: new Date("2026-10-20T01:57:42.867Z"),
      updatedAt: new Date("2026-10-20T01:57:42.868Z"),
      ipAddress: "66.188.77.164",
      userAgent: "Expo/54.0.7 CFNetwork/3896.100.1.2.1 Darwin/27.0.0",
      userId: "u1",
      id: "s1",
    },
    user: {
      name: "Sam Yauger",
      email: "syauger3@gatech.edu",
      emailVerified: false,
      image: null,
      createdAt: new Date("2026-10-20T01:56:50.530Z"),
      updatedAt: new Date("2026-10-20T01:56:50.530Z"),
      id: "u1",
    },
  };

  it("accepts a revived payload and normalizes expiresAt to an ISO string", () => {
    const parsed = toAuthSession(revivedPayload);
    assert.notEqual(parsed, null);
    assert.equal(parsed?.session.id, "s1");
    assert.equal(parsed?.session.expiresAt, "2026-10-27T01:57:42.867Z");
    assert.equal(parsed?.user.id, "u1");
    assert.equal(parsed?.user.name, "Sam Yauger");
  });

  it("still accepts plain string timestamps", () => {
    const parsed = toAuthSession({
      session: { id: "s1", expiresAt: "2026-10-27T01:57:42.867Z" },
      user: { id: "u1", name: "Sam", email: "s@test.dev", image: null },
    });
    assert.equal(parsed?.session.expiresAt, "2026-10-27T01:57:42.867Z");
  });

  it("rejects invalid dates and malformed payloads", () => {
    assert.equal(
      toAuthSession({
        session: { id: "s1", expiresAt: new Date(Number.NaN) },
        user: { id: "u1", name: "Sam", email: "s@test.dev" },
      }),
      null,
    );
    assert.equal(
      toAuthSession({
        session: { id: "s1" },
        user: { id: "u1", name: "Sam", email: "s@test.dev" },
      }),
      null,
    );
    assert.equal(toAuthSession(null), null);
    assert.equal(toAuthSession({ session: null, user: null }), null);
  });

  it("isSessionExpired handles Date timestamps at runtime", () => {
    const now = Date.parse("2026-10-20T12:00:00.000Z");
    const live = {
      user: { id: "u1", name: "T", email: "t@t.dev" },
      session: { id: "s1", expiresAt: new Date("2026-10-20T13:00:00.000Z") },
    } as unknown as AuthSession;
    const past = {
      user: { id: "u1", name: "T", email: "t@t.dev" },
      session: { id: "s1", expiresAt: new Date("2026-10-20T11:00:00.000Z") },
    } as unknown as AuthSession;
    assert.equal(isSessionExpired(live, now), false);
    assert.equal(isSessionExpired(past, now), true);
  });

  it("toISODateString passes strings through and stringifies valid Dates", () => {
    assert.equal(toISODateString("2026-10-20T12:00:00.000Z"), "2026-10-20T12:00:00.000Z");
    assert.equal(
      toISODateString(new Date("2026-10-20T12:00:00.000Z")),
      "2026-10-20T12:00:00.000Z",
    );
    assert.equal(toISODateString(new Date(Number.NaN)), null);
    assert.equal(toISODateString(123), null);
    assert.equal(toISODateString(null), null);
  });
});
