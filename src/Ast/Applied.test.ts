import { describe, expect, it } from "bun:test"
import * as Source from "../Source/index.js"
import { parseEntryPoints } from "./Applied.js"
import type { DataType, SymbolValue } from "./Typed.js"
import { makePath } from "./Untyped.js"

const dataType = (name: string): DataType => ({
  _tag: "DataType",
  path: makePath(Source.DummySpan(), name),
  properties: {},
  variants: {}
})

const globals: Record<string, { symbolValue: SymbolValue }> = {
  Bool: { symbolValue: dataType("Bool") },
  Int: { symbolValue: dataType("Int") },
  ByteArray: { symbolValue: dataType("ByteArray") },
  String: { symbolValue: dataType("String") },
  Real: { symbolValue: dataType("Real") }
}

describe("parseEntryPoints", () => {
  it("parses exported validator main with literal integer rhs", () => {
    const entryPoints = parseEntryPoints(
      [{ name: "v-main.hl", content: "validator demo; export main = 0" }],
      { globals }
    )

    const main = entryPoints["demo::main"]
    if (main === undefined) {
      throw new Error("expected validator main entrypoint")
    }

    expect(main.body._tag).toBe("Literal")
    if (main.body._tag !== "Literal") {
      throw new Error("expected literal body")
    }

    expect(main.body.value._tag).toBe("Int")
    if (main.body.value._tag !== "Int") {
      throw new Error("expected int literal")
    }

    expect(main.body.value.value).toBe(0n)
  })
})
