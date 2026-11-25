import { describe, expect, it } from "vitest";
import { filenameFromDisposition } from "@/lib/api/client";

describe("filenameFromDisposition", () => {
  it("reads quoted and UTF-8 encoded names", () => {
    expect(filenameFromDisposition('attachment; filename="purchase-orders-2026-11-25.csv"')).toBe("purchase-orders-2026-11-25.csv");
    expect(filenameFromDisposition("attachment; filename*=UTF-8''Quote%20%C3%9C.pdf")).toBe("Quote Ü.pdf");
  });
  it("returns null when there is no header", () => { expect(filenameFromDisposition(null)).toBeNull(); });
});
