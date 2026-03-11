import { describe, expect, it } from "bun:test"
import { parse, resolveNames } from "./IR.js"

const source = (content: string) => ({
  name: "IR.test",
  content
})

describe("IR parse", () => {
  it("parses function definitions recursively", () => {
    const expr = parse(source("(a, b)->{addInteger(a, b)}"))

    expect(expr._tag).toBe("FuncDef")
    if (expr._tag !== "FuncDef") {
      throw new Error("expected FuncDef")
    }

    expect(expr.args.fields.map((a) => a.value)).toEqual(["a", "b"])

    const body = expr.body.expr
    expect(body._tag).toBe("Call")
    if (body._tag !== "Call") {
      throw new Error("expected call body")
    }

    expect(body.fn._tag).toBe("Reference")
    expect(body.args.fields.length).toBe(2)
    expect(body.args.fields[0]?._tag).toBe("Reference")
    expect(body.args.fields[1]?._tag).toBe("Reference")
  })

  it("parses error() expression", () => {
    const expr = parse(source("error()"))

    expect(expr._tag).toBe("Error")
  })

  it("parses primitive literals", () => {
    const intExpr = parse(source("42"))
    const boolExpr = parse(source("true"))
    const strExpr = parse(source(`"ok"`))
    const bytesExpr = parse(source("#ff"))

    expect(intExpr._tag).toBe("Literal")
    expect(boolExpr._tag).toBe("Literal")
    expect(strExpr._tag).toBe("Literal")
    expect(bytesExpr._tag).toBe("Literal")
  })

  it("parses unit and parenthesized expressions", () => {
    const unitExpr = parse(source("()"))
    const parensExpr = parse(source("(1)"))

    expect(unitExpr._tag).toBe("Literal")
    if (unitExpr._tag !== "Literal") {
      throw new Error("expected literal unit")
    }
    expect(unitExpr.value._tag).toBe("Unit")

    expect(parensExpr._tag).toBe("Literal")
    if (parensExpr._tag !== "Literal") {
      throw new Error("expected parenthesized literal")
    }
    expect(parensExpr.value._tag).toBe("Int")
  })

  it("resolves a builtin reference", () => {
    const expr = resolveNames(parse(source("addInteger")))

    expect(expr._tag).toBe("Reference")
    if (expr._tag !== "Reference") {
      throw new Error("expected reference")
    }

    expect(expr.isBuiltin).toBe(true)
  })

  it("resolves a function argument from scope", () => {
    const expr = resolveNames(parse(source("(x)->{x}")))

    expect(expr._tag).toBe("FuncDef")
    if (expr._tag !== "FuncDef") {
      throw new Error("expected funcdef")
    }

    expect(expr.body.expr._tag).toBe("Reference")
    if (expr.body.expr._tag !== "Reference") {
      throw new Error("expected body reference")
    }

    expect(expr.body.expr.isBuiltin).toBeUndefined()
    expect(expr.body.expr.isSpecial).toBeUndefined()
  })

  it("resolves special terms only when called", () => {
    const called = resolveNames(parse(source("constr(0, 1)")))

    expect(called._tag).toBe("Call")
    if (called._tag !== "Call") {
      throw new Error("expected call")
    }

    expect(called.fn._tag).toBe("Reference")
    if (called.fn._tag !== "Reference") {
      throw new Error("expected called reference")
    }

    expect(called.fn.isSpecial).toBe(true)
    expect(() => resolveNames(parse(source("constr")))).toThrow(
      /must be called/
    )
  })

  it("throws when a reference is undefined", () => {
    expect(() => resolveNames(parse(source("unknownName")))).toThrow(
      /undefined/
    )
  })
})
