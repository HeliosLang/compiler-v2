import { describe, expect, it } from "bun:test"
import * as Source from "../Source/index.js"
import { generateIR, parseEntryPoints } from "./Applied.js"
import type {
  Assign as AppliedAssign,
  Call as AppliedCall,
  Chain as AppliedChain,
  Construct as AppliedConstruct,
  IfElse as AppliedIfElse,
  ListConstruct as AppliedListConstruct,
  Literal as AppliedLiteral,
  Raw as AppliedRaw,
  Reference as AppliedReference
} from "./Applied.js"
import type * as IR from "./IR.js"
import type { DataType, FuncType, SymbolValue, Type } from "./Typed.js"
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

const dummySpan = () => Source.DummySpan()

const word = <V extends string>(value: V) => ({
  _tag: "Word" as const,
  value,
  sourceSpan: dummySpan()
})

const symbol = <V extends string>(value: V) => ({
  _tag: "Symbol" as const,
  value,
  sourceSpan: dummySpan()
})

const GROUP_CLOSE = {
  "(": ")" as const,
  "[": "]" as const,
  "{": "}" as const
}

const group = <Kind extends "(" | "[" | "{", Field>(
  kind: Kind,
  fields: Field[]
): import("./Token.js").Group<Kind, Field> => ({
  _tag: "Group",
  open: symbol(kind),
  fields,
  separators: fields.slice(1).map(() => symbol(",")),
  close: symbol(
    GROUP_CLOSE[kind] as unknown as import("./Token.js").GroupClose<Kind>
  )
})

const typedData = (
  name: string,
  properties: Record<string, DataType> = {},
  appliedTypes?: DataType[]
): DataType => ({
  _tag: "DataType",
  path: {
    ...makePath(dummySpan(), name),
    ...(appliedTypes ? { appliedTypes } : {})
  },
  properties,
  variants: {}
})

const literal = (value: bigint): AppliedLiteral => ({
  _tag: "Literal" as const,
  value: {
    _tag: "Int" as const,
    value,
    encoding: "Decimal",
    sourceSpan: dummySpan()
  },
  resolved: {
    _tag: "Typed" as const,
    type: dataType("Int")
  }
})

const reference = (
  name: string,
  type: Type = dataType("Int")
): AppliedReference => ({
  _tag: "Reference" as const,
  path: makePath(dummySpan(), name),
  resolved: {
    _tag: "Typed" as const,
    type
  }
})

const irRefName = (expr: IR.Expression) => {
  expect(expr._tag).toBe("Reference")
  if (expr._tag !== "Reference") {
    throw new Error("expected reference")
  }

  return expr.name.value
}

const chain = (
  statements: (AppliedAssign | AppliedCall)[],
  returns: AppliedReference | AppliedLiteral,
  resolvedType: DataType
): AppliedChain => ({
  _tag: "Chain",
  open: symbol("{"),
  statements,
  returns,
  close: symbol("}"),
  resolved: {
    _tag: "Typed",
    type: resolvedType
  }
})

const intTyped = {
  _tag: "Typed" as const,
  type: dataType("Int")
}

const intBranch = (value: bigint): AppliedChain =>
  chain([], literal(value), intTyped.type)

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
          content:
            "validator vadd; export main = (x: Int, y: Int) -> addInteger(1, 2)"
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
          content: `validator vaddChain;
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

describe("generateIR", () => {
  it("reorders keyed constructor args to the underlying property order", () => {
    const pairType = typedData("Pair", {
      first: dataType("Int"),
      second: dataType("Int")
    })
    const expr: AppliedConstruct = {
      _tag: "Construct",
      args: group("{", [
        {
          property: {
            key: word("second"),
            colon: symbol(":")
          },
          value: literal(2n)
        },
        {
          property: {
            key: word("first"),
            colon: symbol(":")
          },
          value: literal(1n)
        }
      ]),
      resolved: {
        _tag: "Typed",
        type: pairType
      }
    }

    const result = generateIR(expr)

    expect(result._tag).toBe("Call")
    if (result._tag !== "Call") {
      throw new Error("expected call")
    }

    expect(irRefName(result.fn)).toBe("Pair:::new")
    expect(result.args.fields[0]?._tag).toBe("Literal")
    expect(result.args.fields[1]?._tag).toBe("Literal")

    if (
      result.args.fields[0]?._tag !== "Literal" ||
      result.args.fields[1]?._tag !== "Literal"
    ) {
      throw new Error("expected literal constructor args")
    }

    expect(result.args.fields[0].value._tag).toBe("Int")
    expect(result.args.fields[1].value._tag).toBe("Int")
    if (
      result.args.fields[0].value._tag !== "Int" ||
      result.args.fields[1].value._tag !== "Int"
    ) {
      throw new Error("expected int constructor args")
    }

    expect(result.args.fields[0].value.value).toBe(1n)
    expect(result.args.fields[1].value.value).toBe(2n)
  })

  it("lowers list constructors into mkCons and to_data calls", () => {
    const intType = dataType("Int")
    const expr: AppliedListConstruct = {
      _tag: "ListConstruct",
      args: group("{", [literal(1n), literal(2n)]),
      resolved: {
        _tag: "Typed",
        type: typedData("List", {}, [intType])
      }
    }

    const result = generateIR(expr)

    expect(result._tag).toBe("Call")
    if (result._tag !== "Call") {
      throw new Error("expected call")
    }

    expect(irRefName(result.fn)).toBe("mkCons")

    const firstHead = result.args.fields[0]
    expect(firstHead?._tag).toBe("Call")
    if (firstHead === undefined || firstHead._tag !== "Call") {
      throw new Error("expected head to_data call")
    }
    expect(irRefName(firstHead.fn)).toBe("Int:::to_data")

    const tail = result.args.fields[1]
    expect(tail?._tag).toBe("Call")
    if (tail === undefined || tail._tag !== "Call") {
      throw new Error("expected tail call")
    }
    expect(irRefName(tail.fn)).toBe("mkCons")

    const lastTail = tail.args.fields[1]
    expect(lastTail?._tag).toBe("Call")
    if (lastTail === undefined || lastTail._tag !== "Call") {
      throw new Error("expected nil tail call")
    }
    expect(irRefName(lastTail.fn)).toBe("mkNilData")
  })

  it("lowers chains into chooseUnit and nested lambda calls", () => {
    const pingCall: AppliedCall = {
      _tag: "Call",
      fn: reference("ping", typedData("Func")),
      args: group("(", []),
      resolved: {
        _tag: "Typed",
        type: dataType("Unit")
      }
    }
    const sumAssign: AppliedAssign = {
      _tag: "Assign",
      name: word("sum"),
      equals: symbol("="),
      rhs: {
        _tag: "Call",
        fn: reference("addInteger", typedData("Func")),
        args: group("(", [literal(1n), literal(2n)]),
        resolved: {
          _tag: "Typed",
          type: dataType("Int")
        }
      }
    }
    const expr: AppliedChain = chain(
      [pingCall, sumAssign],
      reference("sum"),
      dataType("Int")
    )

    const result = generateIR(expr)

    expect(result._tag).toBe("Call")
    if (result._tag !== "Call") {
      throw new Error("expected call")
    }

    expect(irRefName(result.fn)).toBe("chooseUnit")

    const letCall = result.args.fields[1]
    expect(letCall?._tag).toBe("Call")
    if (letCall === undefined || letCall._tag !== "Call") {
      throw new Error("expected let call")
    }

    expect(letCall.fn._tag).toBe("FuncDef")
    if (letCall.fn._tag !== "FuncDef") {
      throw new Error("expected lambda in let call")
    }

    expect(letCall.fn.args.fields.map((arg) => arg.value)).toEqual(["sum"])
  })

  it("lowers nested if/else expressions into thunked ifThenElse calls", () => {
    const nestedElse: AppliedIfElse = {
      _tag: "IfElse",
      if: word("if"),
      condition: reference("otherCond", dataType("Bool")),
      ifBranch: intBranch(2n),
      else: word("else"),
      elseBranch: intBranch(3n),
      resolved: intTyped
    }
    const expr: AppliedIfElse = {
      _tag: "IfElse",
      if: word("if"),
      condition: reference("cond", dataType("Bool")),
      ifBranch: intBranch(1n),
      else: word("else"),
      elseBranch: nestedElse,
      resolved: intTyped
    }

    const result = generateIR(expr)

    expect(result._tag).toBe("Call")
    if (result._tag !== "Call") {
      throw new Error("expected outer call")
    }

    expect(result.args.fields.length).toBe(0)
    expect(result.fn._tag).toBe("Call")
    if (result.fn._tag !== "Call") {
      throw new Error("expected inner ifThenElse call")
    }

    expect(irRefName(result.fn.fn)).toBe("ifThenElse")

    const elseThunk = result.fn.args.fields[2]
    expect(elseThunk?._tag).toBe("FuncDef")
    if (elseThunk === undefined || elseThunk._tag !== "FuncDef") {
      throw new Error("expected else thunk")
    }

    expect(elseThunk.body.expr._tag).toBe("Call")
  })

  it("parses raw IR snippets directly", () => {
    const expr: AppliedRaw = {
      _tag: "Raw",
      resolved: {
        _tag: "Typed",
        type: dataType("Int")
      },
      ir: "addInteger(1, 2)",
      dependencies: []
    }

    const result = generateIR(expr)

    expect(result._tag).toBe("Call")
    if (result._tag !== "Call") {
      throw new Error("expected parsed raw call")
    }

    expect(irRefName(result.fn)).toBe("addInteger")
    expect(result.args.fields.length).toBe(2)
  })
})
