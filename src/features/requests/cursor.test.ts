import { describe, expect, it } from "vitest";
import { parseCursor, REQUEST_PAGE_SIZE } from "./cursor";

describe("request list cursor (#48)", () => {
  it("accepts the id of the last row of a page (UUID) and normalises it to lower case", () => {
    expect(parseCursor("0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55")).toBe("0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55");
    expect(parseCursor("0B9F5C2E-6A1D-4C3E-9F7A-2D4B8E1C0A55")).toBe("0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55");
  });

  it.each([undefined, "", "nonsense", "1", "0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a5", " 0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55", "0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55' or 1=1", ["0b9f5c2e-6a1d-4c3e-9f7a-2d4b8e1c0a55"]])(
    "rejects %j – the list falls back to the first page",
    (value) => {
      expect(parseCursor(value)).toBeNull();
    },
  );

  it("uses a fixed page size of 50", () => {
    expect(REQUEST_PAGE_SIZE).toBe(50);
  });
});
