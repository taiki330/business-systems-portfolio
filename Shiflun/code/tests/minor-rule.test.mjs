import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// 画面側の夜間規制の判定（lib/utils/minor.ts）。DBの violates_minor_night_rule と同じ結果になることを確かめる。
function loadModule(path) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const exports = {};
  vm.runInNewContext(outputText, { exports });
  return exports;
}
const { violatesMinorNightRule } = loadModule("../lib/utils/minor.ts");

test("shifts inside 05:00-22:00 are allowed for under-18 workers", () => {
  for (const [start, end] of [["05:00", "22:00"], ["09:00", "17:00"], ["17:00", "22:00"], ["05:00", "05:30"]]) {
    assert.equal(violatesMinorNightRule(start, end), false, `${start}-${end}`);
  }
});

test("shifts that touch 22:00-05:00 are refused", () => {
  for (const [start, end] of [["17:00", "22:01"], ["21:00", "23:00"], ["18:00", "23:30"], ["04:59", "09:00"], ["00:00", "04:00"], ["03:00", "08:00"]]) {
    assert.equal(violatesMinorNightRule(start, end), true, `${start}-${end}`);
  }
});

test("times with seconds (as stored in the database) work the same way", () => {
  assert.equal(violatesMinorNightRule("17:00:00", "22:00:00"), false);
  assert.equal(violatesMinorNightRule("17:00:00", "22:30:00"), true);
});

test("missing times are not treated as a violation (other validation reports them)", () => {
  assert.equal(violatesMinorNightRule("", "22:30"), false);
  assert.equal(violatesMinorNightRule("17:00", null), false);
  assert.equal(violatesMinorNightRule(undefined, undefined), false);
});
