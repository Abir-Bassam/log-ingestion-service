import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeCursor, decodeCursor } from "../src/utils/cursor.js";

test("round-trips a cursor position", () => {
  const pos = { ts: "2026-08-08T10:00:00.000Z", id: "12345" };
  const decoded = decodeCursor(encodeCursor(pos));
  assert.deepEqual(decoded, pos);
});

test("returns null for garbage input", () => {
  assert.equal(decodeCursor("not-a-real-cursor"), null);
});

test("returns null for valid base64 that isn't our shape", () => {
  const fake = Buffer.from(JSON.stringify({ foo: "bar" })).toString("base64url");
  assert.equal(decodeCursor(fake), null);
});

test("returns null when id is not numeric", () => {
  const bad = Buffer.from(
    JSON.stringify({ ts: "2026-08-08T10:00:00.000Z", id: "abc" })
  ).toString("base64url");
  assert.equal(decodeCursor(bad), null);
});

test("returns null when timestamp is invalid", () => {
  const bad = Buffer.from(
    JSON.stringify({ ts: "nonsense", id: "123" })
  ).toString("base64url");
  assert.equal(decodeCursor(bad), null);
});