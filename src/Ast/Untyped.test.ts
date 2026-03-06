import { describe, expect, it } from "bun:test"
import { parseScript } from "./Untyped.js"

const source = (content: string) => ({
  name: "Untyped.test",
  content
})

describe("parseScript", () => {
  it("parses a construct expression in a declaration type", () => {
    const ast = parseScript(
      source(`module sample value: Foo{a: 1, 2}`)
    )

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
    expect(first.property).toBeDefined()
    if (first.property === undefined) {
      throw new Error("expected first field property")
    }
    expect(first.property.key._tag).toBe("Reference")
    if (first.property.key._tag !== "Reference") {
      throw new Error("expected property key to be Reference")
    }
    expect(first.property.key.path.names.map((n) => n.value)).toEqual(["a"])
    expect(first.value._tag).toBe("Literal")

    const second = typeExpr.args.fields[1]
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
    const ast = parseScript(
      source(`module sample value: mk(1){field: 2}`)
    )

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
})
