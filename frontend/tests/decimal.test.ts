import { describe, expect, it } from "vitest";
import { isDecimal, mul2, pct2, round2, sum2 } from "@/lib/utils/decimal";

describe("exact decimal helpers", () => {
  it("multiplies without floating point error", () => {
    expect(mul2("0.1", "3")).toBe("0.30");
    expect(mul2("100", "65000.10")).toBe("6500010.00");
    expect(mul2("1.005", "1")).toBe("1.01"); // half-up, where 1.005 * 100 in floats is 100.49999
  });
  it("rounds half-up to 2 decimals", () => {
    expect(round2("10.005")).toBe("10.01");
    expect(round2("0.2")).toBe("0.20");
    expect(round2("12000")).toBe("12000.00");
  });
  it("computes a percentage of an amount", () => {
    expect(pct2("6500010.00", "5")).toBe("325000.50");
    expect(pct2("100.00", "7.5")).toBe("7.50");
    expect(pct2("0.00", "5")).toBe("0.00");
  });
  it("sums 2dp strings exactly", () => {
    expect(sum2(["0.10", "0.20"])).toBe("0.30");
    expect(sum2([null, "5.00"])).toBe("5.00");
    expect(sum2([])).toBe("0.00");
  });
  it("matches the server's landed-cost example (6837511.05)", () => {
    const material = mul2("100", "65000.10")!;
    const total = sum2([material, round2("12000")!, round2("500.55")!, pct2(material, "5")!]);
    expect(total).toBe("6837511.05");
  });
  it("rejects malformed input", () => {
    expect(isDecimal("12abc")).toBe(false);
    expect(isDecimal("-5")).toBe(false);
    expect(isDecimal("1.23456")).toBe(false);
    expect(isDecimal("")).toBe(false);
    expect(mul2("x", "2")).toBeNull();
    expect(round2("")).toBeNull();
  });
});
