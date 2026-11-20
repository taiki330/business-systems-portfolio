import assert from "node:assert/strict";
import test from "node:test";
import { calculateOffer, calculateStoreCost, coverageMinutes, japanDate, matchesWorker, rankWorkers, validWorkDate } from "../lib/utils/matching.ts";

test("store pays a 20 percent fee on top of the unchanged worker offer", () => {
  assert.deepEqual(calculateStoreCost(5400), { feePercent: 20, feeYen: 1080, storeTotalYen: 6480 });
  assert.deepEqual(calculateStoreCost(501), { feePercent: 20, feeYen: 100, storeTotalYen: 601 });
});

test("offer uses store rate × net minutes, consistently rounded to yen", () => {
  assert.deepEqual(calculateOffer(1200, "10:00", "15:00", 30), { workMinutes: 270, totalYen: 5400 });
  assert.deepEqual(calculateOffer(1001, "10:00", "10:30"), { workMinutes: 30, totalYen: 501 });
  for (const args of [[1200, "24:00", "25:00", 0], [1200, "18:00", "10:00", 0], [1200, "10:00", "11:00", 60], [1200, "10:00", "11:00", -1], [0, "10:00", "11:00", 0], [1200, "10:00", "11:00", 0.5]]) assert.equal(calculateOffer(...args), null);
});

test("date validation and Japan day boundaries", () => {
  assert.equal(validWorkDate("2026-02-30"), false);
  assert.equal(validWorkDate("2028-02-29"), true);
  assert.equal(japanDate(new Date("2026-09-23T15:00:00Z")), "2026-09-24");
});

test("availability fit merges overlapping slots without double counting", () => {
  assert.equal(coverageMinutes([{ start_time: "10:00:00", end_time: "13:00:00" }, { start_time: "12:00:00", end_time: "15:00:00" }], "11:00", "14:00"), 180);
});

const result = (id, count = 0, start = "10:00", end = "14:00") => ({ worker: { id, completed_scout_count: count }, matchingSlots: [{ start_time: start, end_time: end }] });

test("better time fit always outranks usage count", () => {
  const ranked = rankWorkers([result("veteran", 100, "10:00", "11:00"), result("new", 0)], "10:00", "14:00", "2026-09-23");
  assert.equal(ranked[0].worker.id, "new");
});

test("usage has a bounded boost and new workers rotate into the first block", () => {
  const rows = Array.from({ length: 20 }, (_, i) => result(String(i).padStart(2, "0"), i));
  const baseline = rows.map((r) => result(r.worker.id, 0));
  const exposed = new Set();
  for (let i = 0; i < 20; i++) {
    const day = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
    const order = rankWorkers(rows, undefined, undefined, day);
    const plain = rankWorkers(baseline, undefined, undefined, day);
    assert.equal(new Set(order.map((r) => r.worker.id)).size, rows.length);
    for (let j = 0; j < order.length; j++) {
      const baseIndex = plain.findIndex((r) => r.worker.id === order[j].worker.id);
      assert.ok(Math.abs(baseIndex - j) <= 3);
      if (j % 5 === 0) assert.equal(order[j].worker.id, plain[j].worker.id);
    }
    order.slice(0, 5).forEach((r) => exposed.add(r.worker.id));
    assert.deepEqual(order, rankWorkers(rows, undefined, undefined, day));
  }
  assert.equal(exposed.size, rows.length);
  assert.deepEqual(rankWorkers([result("a", 5), result("b", 1000)], undefined, undefined, "2026-09-23"), rankWorkers([result("a", 5), result("b", 5)], undefined, undefined, "2026-09-23").map((r) => ({ ...r, worker: { ...r.worker, completed_scout_count: r.worker.id === "b" ? 1000 : 5 } })));
});

test("store search filters worker preferences, skills and verification, not worker wages", () => {
  const worker = { preferred_areas: ["大阪市北区", "梅田"], business_type: "カフェ", skill_tags: ["ホール"], verification_status: "verified", experience_years: 2 };
  assert.equal(matchesWorker(worker, { area: "大阪", skill: "ホール", verified: "true", min_experience: "2" }), true);
  assert.equal(matchesWorker(worker, { area: "東京" }), false);
  assert.equal(matchesWorker(worker, { skill: "キッチン" }), false);
  assert.equal(matchesWorker({ ...worker, preferred_areas: [] }, { area: "梅田" }), false);
});
