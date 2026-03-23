import { describe, expect, it } from "bun:test"
import { generateUplc, parse, pretty, resolveNames } from "./IR.js"

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

describe("IR generateUplc", () => {
  it("wraps builtins in their required number of forces", () => {
    const term = generateUplc(parse(source("chooseList")))

    expect(term._tag).toBe("Force")
    if (term._tag !== "Force") {
      throw new Error("expected outer force")
    }

    expect(term.arg._tag).toBe("Force")
    if (term.arg._tag !== "Force") {
      throw new Error("expected inner force")
    }

    expect(term.arg.arg._tag).toBe("Builtin")
    if (term.arg.arg._tag !== "Builtin") {
      throw new Error("expected builtin")
    }

    expect(term.arg.arg.name).toBe("chooseList")
    expect(term.arg.arg.id).toBe(31)
  })

  it("uses DeBruijn indices for lambda-bound variables", () => {
    const term = generateUplc(parse(source("(a, b)->{a}")))

    expect(term._tag).toBe("Lambda")
    if (term._tag !== "Lambda") {
      throw new Error("expected outer lambda")
    }

    expect(term.argName).toBe("a")
    expect(term.body._tag).toBe("Lambda")
    if (term.body._tag !== "Lambda") {
      throw new Error("expected inner lambda")
    }

    expect(term.body.argName).toBe("b")
    expect(term.body.body._tag).toBe("Var")
    if (term.body.body._tag !== "Var") {
      throw new Error("expected body var")
    }

    expect(term.body.body.index).toBe(2)
    expect(term.body.body.name).toBe("a")
  })

  it("lowers zero-arg funcs to delay and zero-arg calls to force", () => {
    const term = generateUplc(parse(source("(() -> {1})()")))

    expect(term._tag).toBe("Force")
    if (term._tag !== "Force") {
      throw new Error("expected force")
    }

    expect(term.arg._tag).toBe("Delay")
    if (term.arg._tag !== "Delay") {
      throw new Error("expected delay")
    }

    expect(term.arg.arg._tag).toBe("Const")
  })

  it("converts constr() and case() calls directly into UPLC terms", () => {
    const constr = generateUplc(parse(source("constr(0, 1, 2)")))

    expect(constr._tag).toBe("Constr")
    if (constr._tag !== "Constr") {
      throw new Error("expected constr")
    }

    expect(constr.tag).toBe(0)
    expect(constr.args).toHaveLength(2)
    expect(constr.args[0]?._tag).toBe("Const")
    expect(constr.args[1]?._tag).toBe("Const")

    const caseTerm = generateUplc(parse(source("(x, a, b)->{case(x, a, b)}")))

    expect(caseTerm._tag).toBe("Lambda")
    if (
      caseTerm._tag !== "Lambda" ||
      caseTerm.body._tag !== "Lambda" ||
      caseTerm.body.body._tag !== "Lambda" ||
      caseTerm.body.body.body._tag !== "Case"
    ) {
      throw new Error("expected nested lambdas ending in case")
    }

    expect(caseTerm.body.body.body.arg._tag).toBe("Var")
    if (caseTerm.body.body.body.arg._tag !== "Var") {
      throw new Error("expected case arg var")
    }

    expect(caseTerm.body.body.body.arg.index).toBe(3)
    expect(caseTerm.body.body.body.cases[0]?._tag).toBe("Var")
    expect(caseTerm.body.body.body.cases[1]?._tag).toBe("Var")

    if (
      caseTerm.body.body.body.cases[0]?._tag !== "Var" ||
      caseTerm.body.body.body.cases[1]?._tag !== "Var"
    ) {
      throw new Error("expected case branches to be vars")
    }

    expect(caseTerm.body.body.body.cases[0].index).toBe(2)
    expect(caseTerm.body.body.body.cases[1].index).toBe(1)
  })

  it("lowers error() to an UPLC error term", () => {
    const term = generateUplc(parse(source("error()")))

    expect(term._tag).toBe("Error")
  })
})

describe("IR pretty", () => {
  it("formats expressions as single-line IR when they fit", () => {
    const expr = parse(source("(a, b)->{addInteger(a, b)}"))

    expect(pretty(expr)).toBe("(a, b) -> {addInteger(a, b)}")
  })

  it("formats expressions with configurable newlines and tabs when forced to wrap", () => {
    const expr = parse(source("(a, b)->{addInteger(a, b)}"))

    expect(
      pretty(expr, { maxLineLength: 19, newline: "\n", tab: "    " })
    ).toBe(
      [
        "(a, b) -> {",
        "    addInteger(",
        "        a,",
        "        b",
        "    )",
        "}"
      ].join("\n")
    )
  })

  it("formats immediately-applied single-arg funcs as assignment sugar", () => {
    const expr = parse(source("((x)->{addInteger(x, 1)})(2)"))

    expect(pretty(expr)).toBe("{x = 2; addInteger(x, 1)}")
  })

  it("formats nested immediately-applied single-arg funcs as chained assignments", () => {
    const expr = parse(source("((x)->{((y)->{addInteger(x, y)})(2)})(1)"))

    expect(
      pretty(expr, { maxLineLength: 12, newline: "\n", tab: "    " })
    ).toBe(
      [
        "{",
        "    x = 1",
        "    y = 2",
        "    addInteger(",
        "        x,",
        "        y",
        "    )",
        "}"
      ].join("\n")
    )
  })

  it("doesn't print duplicate braces for sugared function bodies", () => {
    const expr = parse(source("(x)->{((y)->{addInteger(x, y)})(2)}"))

    expect(pretty(expr)).toBe("(x) -> {y = 2; addInteger(x, y)}")
  })

  it("doesn't print a spurious opening brace in wrapped function bodies", () => {
    const expr = parse(source("(x)->{((y)->{addInteger(x, y)})(1234567890)}"))

    expect(
      pretty(expr, { maxLineLength: 19, newline: "\n", tab: "    " })
    ).toBe(
      [
        "(x) -> {",
        "    y = 1234567890",
        "    addInteger(",
        "        x,",
        "        y",
        "    )",
        "}"
      ].join("\n")
    )
  })

  it("indents the first wrapped line in nested function bodies correctly", () => {
    const expr = parse(source("(x)->{(a, b)->{addInteger(a, b)}}"))

    expect(
      pretty(expr, { maxLineLength: 19, newline: "\n", tab: "    " })
    ).toBe(
      [
        "(x) -> {",
        "    (a, b) -> {",
        "        addInteger(",
        "            a,",
        "            b",
        "        )",
        "    }",
        "}"
      ].join("\n")
    )
  })

  it("accounts for indent when deciding whether to wrap", () => {
    const expr = parse(source("((value)->{value})(1234567890)"))

    expect(
      pretty(expr, { maxLineLength: 20, newline: "\n", tab: "    " })
    ).toBe(["{", "    value = 1234567890", "    value", "}"].join("\n"))
  })
})
