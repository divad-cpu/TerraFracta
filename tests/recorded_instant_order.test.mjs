import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { compareRecordedInstants } from "../src/recorded-instant-order.ts";

test("recorded instants preserve decimal chronology independently of millisecond truncation", () => {
  const values = ["", ".000000000000001", ".000000001", ".000001", ".001", ".09", ".1", ".10000001", ".9", ".99"];
  for (let i = 0; i < values.length; i++) for (let j = 0; j < values.length; j++) {
    const left = `2026-10-06T12:00:00${values[i]}Z`, right = `2026-10-06T12:00:00${values[j]}Z`;
    assert.equal(z.iso.datetime().safeParse(left).success, true); assert.equal(z.iso.datetime().safeParse(right).success, true);
    assert.equal(compareRecordedInstants(left, right), Math.sign(i - j));
  }
});

test("equivalent offsets and decimal precision compare equal, including omitted decimal fractions", () => {
  for (const [left, right] of [
    ["2026-10-06T12:00:00.001Z", "2026-10-06T14:00:00.001000+02:00"],
    ["2026-10-06T12:00:00.123456789Z", "2026-10-06T07:00:00.123456789000-05:00"],
    ["2026-10-06T12:00:00Z", "2026-10-06T12:00:00.000000-00:00"],
    ["2026-01-01T00:00:00Z", "2025-12-31T19:00:00-05:00"],
  ]) {
    for (const value of [left, right]) assert.equal(z.iso.datetime({ offset: true }).safeParse(value).success, true);
    assert.equal(compareRecordedInstants(left, right), 0); assert.equal(compareRecordedInstants(right, left), 0);
  }
});

test("whole-second chronology dominates fractions across epoch and accepted calendar boundaries", () => {
  for (const [first, second] of [
    ["1969-12-31T23:59:59.999999999Z", "1970-01-01T00:00:00Z"],
    ["2024-02-29T23:59:59.999999Z", "2024-03-01T00:00:00Z"],
    ["0000-01-01T00:00:00Z", "0001-01-01T00:00:00Z"],
    ["9998-12-31T23:59:59.999999Z", "9999-01-01T00:00:00Z"],
  ]) {
    for (const value of [first, second]) assert.equal(z.iso.datetime().safeParse(value).success, true);
    assert.equal(compareRecordedInstants(first, second), -1); assert.equal(compareRecordedInstants(second, first), 1);
  }
});

test("unreadable recorded instants cannot establish an order", () => {
  for (const bad of ["not-a-recorded-time", "2026-10-06T12:00:00", "badZ"]) {
    assert.throws(() => compareRecordedInstants(bad, "2026-10-06T12:00:00Z"), /Recorded time unavailable/);
    assert.throws(() => compareRecordedInstants("2026-10-06T12:00:00Z", bad), /Recorded time unavailable/);
  }
});
