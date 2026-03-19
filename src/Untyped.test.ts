import { describe, expect, it } from "bun:test"
import { parseScript } from "./Untyped.js"

const source = (content: string) => ({
  name: "Untyped.test",
  content
})

describe("parseScript", () => {
  it("parses a construct expression in a declaration type", () => {
    const ast = parseScript(source(`module sample value: Foo{a: 1, 2}`))

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const typeExpr = declare.type.type
    if (typeExpr._tag !== "Construct") {
      throw new Error("expected Construct expression")
    }

    expect(typeExpr.type._tag).toBe("Reference")
    if (typeExpr.type._tag !== "Reference") {
      throw new Error("expected Construct type to be Reference")
    }
    expect(typeExpr.type.path.names.map((n) => n.value)).toEqual(["Foo"])

    expect(typeExpr.args.fields.length).toBe(2)

    const first = typeExpr.args.fields[0]

    if (!("property" in first)) {
      throw new Error("expected first field property")
    }

    expect(first.property).toBeDefined()

    expect(first.property.key._tag).toBe("Reference")
    if (first.property.key._tag !== "Reference") {
      throw new Error("expected property key to be Reference")
    }
    expect(first.property.key.path.names.map((n) => n.value)).toEqual(["a"])
    expect(first.value._tag).toBe("Literal")

    const second = typeExpr.args.fields[1]
    if (!("property" in second)) {
      throw new Error("expected second field property")
    }
    expect(second.property).toBeUndefined()
    expect(second.value._tag).toBe("Literal")
  })

  it("parses member access before construct in postfix order", () => {
    const ast = parseScript(
      source(`module sample value: MyType.member{field: 1}`)
    )

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const typeExpr = declare.type.type
    if (typeExpr._tag !== "Construct") {
      throw new Error("expected Construct expression")
    }

    expect(typeExpr.type._tag).toBe("Member")
    if (typeExpr.type._tag !== "Member") {
      throw new Error("expected Construct type to be Member")
    }
    expect(typeExpr.type.member.value).toBe("member")
  })

  it("parses call before construct in postfix order", () => {
    const ast = parseScript(source(`module sample value: mk(1){field: 2}`))

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const typeExpr = declare.type.type
    if (typeExpr._tag !== "Construct") {
      throw new Error("expected Construct expression")
    }

    expect(typeExpr.type._tag).toBe("Call")
    if (typeExpr.type._tag !== "Call") {
      throw new Error("expected Construct type to be Call")
    }
    expect(typeExpr.type.args.fields.length).toBe(1)
  })

  it("parses generic + function declaration + operator precedence", () => {
    const ast = parseScript(
      source(`module sample expr: [A, B] => (A, B) -> -A + B * A`)
    )

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const generic = declare.type.type
    expect(generic._tag).toBe("Generic")
    if (generic._tag !== "Generic") {
      throw new Error("expected Generic expression")
    }

    expect(generic.args.fields.map((n) => n.value)).toEqual(["A", "B"])

    const fn = generic.body
    expect(fn._tag).toBe("FuncDecl")
    if (fn._tag !== "FuncDecl") {
      throw new Error("expected FuncDecl body")
    }

    const body = fn.body
    expect(body._tag).toBe("BinaryOp")
    if (body._tag !== "BinaryOp") {
      throw new Error("expected BinaryOp in function body")
    }
    expect(body.op.value).toBe("+")
    expect(body.left._tag).toBe("UnaryOp")
    expect(body.right._tag).toBe("BinaryOp")
    if (body.right._tag !== "BinaryOp") {
      throw new Error("expected right side BinaryOp")
    }
    expect(body.right.op.value).toBe("*")
  })

  it("parses chain expressions with statements and return value", () => {
    const ast = parseScript(source(`module sample decision: { ping(); ok }`))

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const expr = declare.type.type
    expect(expr._tag).toBe("Chain")
    if (expr._tag !== "Chain") {
      throw new Error("expected Chain expression")
    }

    expect(expr.statements.length).toBe(1)
    expect(expr.statements[0]?._tag).toBe("Call")
    expect(expr.returns._tag).toBe("Reference")
  })

  it("parses struct as a primary expression", () => {
    const ast = parseScript(
      source(`module sample value: struct { count: Int, flag: Bool "flag" }`)
    )

    const declare = ast.statements[0]
    if (declare?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    const expr = declare.type.type
    expect(expr._tag).toBe("Struct")
    if (expr._tag !== "Struct") {
      throw new Error("expected Struct expression")
    }

    expect(expr.fields.map((field) => field.name.value)).toEqual([
      "count",
      "flag"
    ])
    expect(expr.fields[0]?.type.type._tag).toBe("Reference")
    expect(expr.fields[0]?.key).toBeUndefined()
    expect(expr.fields[1]?.key?.value).toBe("flag")
  })

  it("parses import + export declare with construct expression", () => {
    const ast = parseScript(
      source(`module sample import A::B; export out: mk(1){x: 2}`)
    )

    expect(ast.statements.length).toBe(2)
    expect(ast.statements[0]?._tag).toBe("Import")
    expect(ast.statements[1]?._tag).toBe("Declare")

    const exp = ast.statements[1]
    if (exp?._tag !== "Declare") {
      throw new Error("expected Declare statement")
    }

    expect(exp.export?.value).toBe("export")
    expect(exp.type.type._tag).toBe("Construct")
  })

  it("parses a plain assignment statement", () => {
    const ast = parseScript(source(`module sample value = mk(1){x: 2}`))

    const stmt = ast.statements[0]
    expect(stmt?._tag).toBe("Assign")
    if (stmt?._tag !== "Assign") {
      throw new Error("expected Assign statement")
    }

    expect(stmt.name.value).toBe("value")
    expect(stmt.equals.value).toBe("=")
    expect(stmt.type).toBeUndefined()
    expect(stmt.rhs._tag).toBe("Construct")
  })

  it("parses an assignment statement with a type guard", () => {
    const ast = parseScript(source(`module sample result: Num = a + b * c`))

    const stmt = ast.statements[0]
    expect(stmt?._tag).toBe("Assign")
    if (stmt?._tag !== "Assign") {
      throw new Error("expected Assign statement")
    }

    expect(stmt.name.value).toBe("result")
    expect(stmt.type).toBeDefined()
    if (stmt.type === undefined) {
      throw new Error("expected type guard on assignment")
    }
    expect(stmt.type.type._tag).toBe("Reference")
    if (stmt.type.type._tag !== "Reference") {
      throw new Error("expected assignment type to be Reference")
    }
    expect(stmt.type.type.path.names.map((n) => n.value)).toEqual(["Num"])
    expect(stmt.rhs._tag).toBe("BinaryOp")
  })

  it("parses export assignment statements", () => {
    const ast = parseScript(source(`module sample; export out = Foo{a: 1}`))

    const stmt = ast.statements[0]
    expect(stmt?._tag).toBe("Assign")
    if (stmt?._tag !== "Assign") {
      throw new Error("expected Assign statement")
    }

    expect(stmt.export?.value).toBe("export")
    expect(stmt.name.value).toBe("out")
    expect(stmt.rhs._tag).toBe("Construct")
  })

  it("throws when a statement defines a duplicate script-scope name", () => {
    expect(() =>
      parseScript(source(`module sample import A::B; B: Num`))
    ).toThrow(/'B' already defined/)
  })
})
