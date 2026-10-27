import { describe, expect, it } from "vitest";

import { inlineCode } from "../src/markdown";

describe("inlineCode", () => {
  it("wraps values without backticks in single backticks", () => {
    expect(inlineCode("string | number")).toBe("`string | number`");
    expect(inlineCode("1.4.0")).toBe("`1.4.0`");
  });

  it("uses the N+1 delimiter form for a value containing a backtick", () => {
    expect(inlineCode("`prefix-${string}`")).toBe("`` `prefix-${string}` ``");
  });

  it("uses one more delimiter backtick than the longest backtick run", () => {
    expect(inlineCode("a``b")).toBe("```a``b```");
  });

  it("pads a value that ends with a backtick", () => {
    expect(inlineCode("abc`")).toBe("`` abc` ``");
  });

  it("pads a value that starts with a backtick", () => {
    expect(inlineCode("`abc")).toBe("`` `abc ``");
  });
});
