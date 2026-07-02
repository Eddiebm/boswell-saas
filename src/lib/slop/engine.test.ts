import { describe, expect, it } from "vitest";
import { scanAiSlop } from "@/lib/slop/engine";

describe("scanAiSlop", () => {
  it("detects bloated files and prompt comments", () => {
    const result = scanAiSlop({
      files: [
        {
          path: "src/big.tsx",
          lines: 500,
          content: "// TODO: implement\n".repeat(10) + "function handleData() {}",
        },
      ],
    });
    expect(result.overallPercent).toBeGreaterThan(0);
    expect(result.topCauses.length).toBeGreaterThan(0);
  });
});
