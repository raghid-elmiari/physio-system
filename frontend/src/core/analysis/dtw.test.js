import { describe, expect, it } from "vitest";
import { dtw, featureDeviations, resample } from "./dtw.js";

// One-feature "repetition": 0 -> peak -> 0 over n frames.
const bump = (n, peak = 90) => Array.from({ length: n }, (_, i) => [peak * Math.sin((Math.PI * i) / (n - 1))]);

describe("dtw", () => {
  it("is zero for identical series", () => {
    const r = dtw(bump(40), bump(40));
    expect(r.distance).toBe(0);
    expect(r.path[0]).toEqual([0, 0]);
    expect(r.path.at(-1)).toEqual([39, 39]);
  });

  it("ignores speed: the same movement done twice as slowly stays close", () => {
    const slow = dtw(bump(80), bump(40));
    expect(slow.normalized).toBeLessThan(2);
  });

  it("detects a smaller range of motion, but understates it (warping), so ROM is also checked separately", () => {
    const short = dtw(bump(40, 60), bump(40, 90));
    expect(short.normalized).toBeGreaterThan(5);
    expect(short.normalized).toBeLessThan(30 * (2 / Math.PI)); // mean gap without warping ~19°
  });

  it("reports which feature was off and in which direction", () => {
    const ref = bump(40).map(([v]) => [v, 175]);
    const pat = bump(40).map(([v]) => [v, 140]); // second feature 35° lower throughout
    const r = dtw(pat, ref);
    const dev = featureDeviations(pat, ref, r.path);
    expect(dev[0]).toBeCloseTo(0, 5);
    expect(dev[1]).toBeCloseTo(-35, 5);
  });

  it("returns Infinity for empty input", () => {
    expect(dtw([], bump(10)).distance).toBe(Infinity);
  });
});

describe("resample", () => {
  it("keeps the end points and changes the length", () => {
    const r = resample(bump(101), 51);
    expect(r).toHaveLength(51);
    expect(r[0][0]).toBeCloseTo(0, 5);
    expect(r[25][0]).toBeCloseTo(90, 5);
    expect(r[50][0]).toBeCloseTo(0, 5);
  });
});
