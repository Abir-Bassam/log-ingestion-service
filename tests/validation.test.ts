import { test } from "node:test";
import assert from "node:assert/strict";
import { validateEntry } from "../src/services/validation.js";

// entry أساسي صحيح نبني عليه حالات الاختبار.
const base = {
  timestamp: new Date().toISOString(),
  level: "info",
  service: "checkout",
  message: "hello",
};

test("accepts a minimal valid entry", () => {
  const r = validateEntry(base);
  assert.equal(r.ok, true);
});

test("accepts flat attributes with scalar values", () => {
  const r = validateEntry({
    ...base,
    attributes: { user_id: "42", retries: 3, ok: true },
  });
  assert.equal(r.ok, true);
});

test("rejects an unknown level with a clear reason", () => {
  const r = validateEntry({ ...base, level: "critical" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.reason, /invalid level: 'critical'/);
});

test("rejects a missing timestamp", () => {
  const { timestamp: _ts, ...rest } = base;
  const r = validateEntry(rest);
  assert.equal(r.ok, false);
});

// Date.parse("2026") صحيح بـ JS بس مش timestamp صحيح للـ log.
test("rejects a loose timestamp that Date.parse would accept", () => {
  const r = validateEntry({ ...base, timestamp: "2026" });
  assert.equal(r.ok, false);
});

test("rejects a timestamp more than five minutes in the future", () => {
  const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const r = validateEntry({ ...base, timestamp: future });
  assert.equal(r.ok, false);
});

test("rejects an empty service", () => {
  const r = validateEntry({ ...base, service: "" });
  assert.equal(r.ok, false);
});

test("rejects nested attributes (object inside object)", () => {
  const r = validateEntry({
    ...base,
    attributes: { nested: { a: 1 } },
  });
  assert.equal(r.ok, false);
});