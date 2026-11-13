import assert from "node:assert/strict";
import { test } from "node:test";
import { distribution, entriesPerHour } from "../window-model.mjs";

test("continuous saving merges inside each window", () => {
  assert.equal(entriesPerHour(3600, 10), 360);
  assert.equal(entriesPerHour(3600, 60), 60);
  assert.equal(entriesPerHour(3600, 300), 12);
});

test("a save exactly at the window edge opens a new entry", () => {
  assert.equal(entriesPerHour(360, 10), 360);
});

test("sparse saves never merge into one window", () => {
  assert.equal(entriesPerHour(60, 10), 60);
  assert.equal(entriesPerHour(60, 300), 12);
});

test("entriesPerHour rejects invalid inputs", () => {
  assert.throws(() => entriesPerHour(0, 10), RangeError);
  assert.throws(() => entriesPerHour(1.5, 10), RangeError);
  assert.throws(() => entriesPerHour(60, 0), RangeError);
});

test("distribution uses nearest-rank p90 and averages an even median", () => {
  assert.deepEqual(distribution([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
    count: 10,
    min: 1,
    median: 5.5,
    p90: 9,
    max: 10,
    sum: 55,
  });
});

test("distribution does not reorder its input", () => {
  const values = [3, 1, 2];
  distribution(values);
  assert.deepEqual(values, [3, 1, 2]);
});

test("distribution rejects an empty list", () => {
  assert.throws(() => distribution([]), RangeError);
});
