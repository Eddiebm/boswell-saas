import { describe, expect, it } from "vitest";
import { balancedArgs, escapeRegExp, findCalls, splitArgs, stripComments } from "@/lib/checks/source-utils";

describe("balancedArgs", () => {
  it("returns the text inside matching parentheses, across nested brackets", () => {
    const src = 'fetch(url, { headers: { a: [1, 2] } }).then(x)';
    expect(balancedArgs(src, src.indexOf("("))).toBe("url, { headers: { a: [1, 2] } }");
  });

  it("ignores brackets inside strings and comments", () => {
    const src = 'call(")", \'(\', `)`, /* ) */ x // )\n, y)';
    expect(balancedArgs(src, 4)).toBe('")", \'(\', `)`, /* ) */ x // )\n, y');
  });

  it("handles escaped quotes inside strings", () => {
    const src = 'f("a\\")b", c)';
    expect(balancedArgs(src, 1)).toBe('"a\\")b", c');
  });

  it("returns null when not at a parenthesis, unbalanced, or past the limit", () => {
    expect(balancedArgs("f(x)", 0)).toBeNull();
    expect(balancedArgs("f(x, (y)", 1)).toBeNull();
    expect(balancedArgs(`f(${"x".repeat(50)})`, 1, 10)).toBeNull();
  });
});

describe("splitArgs", () => {
  it("splits on top-level commas only", () => {
    expect(splitArgs('a, { b: 1, c: [2, 3] }, fn(d, e), "x,y"')).toEqual(["a", "{ b: 1, c: [2, 3] }", "fn(d, e)", '"x,y"']);
  });

  it("keeps template literal interpolations intact", () => {
    expect(splitArgs("`${a}, ${b}`, c")).toEqual(["`${a}, ${b}`", "c"]);
  });

  it("drops a trailing comma and returns nothing for empty args", () => {
    expect(splitArgs("a, b,")).toEqual(["a", "b"]);
    expect(splitArgs("   ")).toEqual([]);
  });
});

describe("findCalls", () => {
  it("finds bare calls but not methods or longer identifiers", () => {
    const src = "fetch(a);\nclient.fetch(b);\nrefetch(c);\nawait fetch (d, { e })";
    expect(findCalls(src, /fetch/)).toEqual([
      { index: 0, args: "a" },
      { index: src.lastIndexOf("fetch"), args: "d, { e }" },
    ]);
  });

  it("supports alternatives in the name pattern", () => {
    const calls = findCalls("eval(x); new Function(y)", /eval|Function/);
    expect(calls.map((c) => c.args)).toEqual(["x", "y"]);
  });
});

describe("escapeRegExp", () => {
  it("makes every special character literal", () => {
    const text = "a.b*c+d?e^f${g}(h)|[i]\\j";
    expect(new RegExp(`^${escapeRegExp(text)}$`).test(text)).toBe(true);
    expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
  });
});

describe("stripComments", () => {
  it("removes line and block comments", () => {
    expect(stripComments("a(); // call b()\n/* c()\n d() */e();")).toBe("a(); \ne();");
  });

  it("keeps URLs and comment markers inside strings", () => {
    const src = 'const u = "https://example.com"; const s = "//not a comment";';
    expect(stripComments(src)).toBe(src);
  });
});
