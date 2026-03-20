import { describe, expect, it } from "bun:test"
import { Syntax } from "./CompilerError.js"

describe("CompilerError", () => {
  it("formats source offsets as 1-based line and character numbers", () => {
    const error = new Syntax(
      {
        source: {
          name: "sample.hl",
          content: "alpha\nbeta\ngamma"
        },
        start: 8,
        end: 8
      },
      "boom"
    )

    expect(error.message).toBe("sample.hl:2:3: boom")
  })

  it("treats CRLF as a single line break", () => {
    const error = new Syntax(
      {
        source: {
          name: "sample.hl",
          content: "a\r\nbc"
        },
        start: 3,
        end: 3
      },
      "boom"
    )

    expect(error.message).toBe("sample.hl:2:1: boom")
  })
})
