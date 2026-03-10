import { describe, expect, it } from "bun:test"
import * as Source from "../Source/index.js"
import { parseEntryPoints } from "./Applied.js"
import type { DataType, FuncType, SymbolValue } from "./Typed.js"
import { makePath } from "./Untyped.js"

const dataType = (name: string): DataType => ({
  _tag: "DataType",
  path: makePath(Source.DummySpan(), name),
  properties: {},
  variants: {}
})

const addIntegerType: FuncType = {
  _tag: "FuncType",
  args: [dataType("Int"), dataType("Int")],
  returns: dataType("Int")
}

const globals: Record<
  string,
  { symbolValue: SymbolValue; implementation?: { ir: string; deps: string[] } }
> = {
  Bool: { symbolValue: dataType("Bool") },
  Int: { symbolValue: dataType("Int") },
  ByteArray: { symbolValue: dataType("ByteArray") },
  String: { symbolValue: dataType("String") },
  Real: { symbolValue: dataType("Real") },
  addInteger: {
    symbolValue: {
      _tag: "Typed",
      type: addIntegerType,
      path: makePath(Source.DummySpan(), "addInteger")
    },
    implementation: {
      ir: "(a,b)->{addInteger(a,b)}",
      deps: []
    }
  }
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

  it("parses exported validator main function calling addInteger with integer literals", () => {
    const entryPoints = parseEntryPoints(
      [
        {
          name: "v-add.hl",
          content: "validator vadd; export main = (x: Int, y: Int) -> addInteger(1, 2)"
        }
      ],
      { globals }
    )

    const main = entryPoints["vadd::main"]
    if (main === undefined) {
      throw new Error("expected validator main entrypoint")
    }

    expect(main.body._tag).toBe("FuncDef")
    if (main.body._tag !== "FuncDef") {
      throw new Error("expected funcdef body")
    }

    expect(main.body.body._tag).toBe("Call")
    if (main.body.body._tag !== "Call") {
      throw new Error("expected call expression")
    }

    expect(main.body.body.fn._tag).toBe("Reference")
    expect(main.body.body.args.fields.length).toBe(2)

    expect(main.body.body.args.fields[0]?._tag).toBe("Literal")
    expect(main.body.body.args.fields[1]?._tag).toBe("Literal")
    if (
      main.body.body.args.fields[0]?._tag !== "Literal" ||
      main.body.body.args.fields[1]?._tag !== "Literal"
    ) {
      throw new Error("expected literal call arguments")
    }

    expect(main.body.body.args.fields[0].value._tag).toBe("Int")
    expect(main.body.body.args.fields[1].value._tag).toBe("Int")
    if (
      main.body.body.args.fields[0].value._tag !== "Int" ||
      main.body.body.args.fields[1].value._tag !== "Int"
    ) {
      throw new Error("expected int literal call arguments")
    }

    expect(main.body.body.args.fields[0].value.value).toBe(1n)
    expect(main.body.body.args.fields[1].value.value).toBe(2n)
  })

  it("parses exported validator main function with chain body assigning addInteger result before return", () => {
    const entryPoints = parseEntryPoints(
      [
        {
          name: "v-add-chain.hl",
          content:
            `validator vaddChain;
            export main = (x: Int, y: Int): Int -> { 
              sum = addInteger(1, 2)
              sum 
            }`
        }
      ],
      { globals }
    )

    const main = entryPoints["vaddChain::main"]
    if (main === undefined) {
      throw new Error("expected validator main entrypoint")
    }

    expect(main.body._tag).toBe("FuncDef")
    if (main.body._tag !== "FuncDef") {
      throw new Error("expected funcdef body")
    }

    expect(main.body.body._tag).toBe("Chain")
    if (main.body.body._tag !== "Chain") {
      throw new Error("expected chain function body")
    }

    expect(main.body.body.statements.length).toBe(1)
    const statement = main.body.body.statements[0]
    expect(statement?._tag).toBe("Assign")
    if (statement === undefined || statement._tag !== "Assign") {
      throw new Error("expected assign statement")
    }

    expect(statement.rhs._tag).toBe("Call")
    if (statement.rhs._tag !== "Call") {
      throw new Error("expected call assignment rhs")
    }

    expect(statement.rhs.args.fields.length).toBe(2)
    expect(main.body.body.returns._tag).toBe("Reference")
  })
})
