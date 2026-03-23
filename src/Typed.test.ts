import { describe, expect, it } from "bun:test"
import * as Source from "./Source.js"
import {
  parseScripts,
  pathToString,
  type DataType,
  type GenericValue,
  type Scope,
  type Path
} from "./Typed.js"
import * as Untyped from "./Untyped.js"

const source = (name: string, content: string) => ({
  name,
  content
})

const makePath = (path: string): Path =>
  Untyped.makePath(Source.DummySpan(), path)

const dataType = (
  path: string,
  appliedTypes?: DataType[],
  from_data?: DataType["from_data"]
): DataType => ({
  _tag: "DataType",
  path:
    appliedTypes === undefined || appliedTypes.length == 0
      ? makePath(path)
      : {
          ...makePath(path),
          appliedTypes
        },
  properties: {},
  variants: {},
  ...(from_data === undefined ? {} : { from_data })
})

const listGeneric: GenericValue = {
  _tag: "GenericValue",
  nArgs: 1,
  type: ([item]) => dataType("List", [item])
}

const mapGeneric: GenericValue = {
  _tag: "GenericValue",
  nArgs: 2,
  type: ([key, value]) => dataType("Map", [key, value])
}

const headListGeneric: GenericValue = {
  _tag: "GenericValue",
  nArgs: 1,
  inferCall: ([list]) => {
    const item = list.path.appliedTypes?.[0]

    if (item === undefined) {
      throw new Error("headList() expects a list argument")
    }

    return [item]
  },
  type: ([item]) => ({
    _tag: "Typed",
    path: makePath("headList"),
    type: {
      _tag: "FuncType",
      args: [listGeneric.type([item]) as DataType],
      returns: item
    }
  })
}

const pipeIdGeneric: GenericValue = {
  _tag: "GenericValue",
  nArgs: 1,
  inferCall: ([value]) => [value],
  type: ([value]) => ({
    _tag: "Typed",
    path: makePath("pipeId"),
    type: {
      _tag: "FuncType",
      args: [value],
      returns: value
    }
  })
}

const builtins: Scope = {
  Bool: dataType("Bool", undefined, {
    ir: "(data) -> {equalsInteger(sndPair(unConstrData(data)),1)}",
    deps: []
  }),
  Int: dataType("Int", undefined, {
    ir: "unIData",
    deps: []
  }),
  ByteArray: dataType("ByteArray", undefined, {
    ir: "unBData",
    deps: []
  }),
  String: dataType("String", undefined, {
    ir: "(data) -> {decodeUtf8(unBData(data))}",
    deps: []
  }),
  Real: dataType("Real", undefined, {
    ir: "unIData",
    deps: []
  }),
  List: listGeneric,
  Map: mapGeneric,
  headList: headListGeneric,
  pipeId: pipeIdGeneric
}

describe("Typed.parseScripts", () => {
  it("resolves exported top-level values into the script namespace", () => {
    const scripts = parseScripts(
      [source("basic.hl", `module basic; export one = 1; export ok = true`)],
      builtins
    )

    const basic = scripts["basic"]
    if (basic === undefined) {
      throw new Error("expected script 'basic'")
    }

    const one = basic.resolved.members["one"]
    const ok = basic.resolved.members["ok"]

    if (one?._tag !== "Typed" || one.type._tag !== "DataType") {
      throw new Error("expected 'one' to be a Typed DataType")
    }
    if (ok?._tag !== "Typed" || ok.type._tag !== "DataType") {
      throw new Error("expected 'ok' to be a Typed DataType")
    }

    expect(pathToString(one.type.path)).toBe("Int")
    expect(Untyped.pathToString(ok.type.path)).toBe("Bool")
  })

  it("resolves imports and namespace references across scripts", () => {
    const scripts = parseScripts(
      [
        source("alpha.hl", `module alpha; export one = 1`),
        source(
          "beta.hl",
          `module beta; import alpha; export copied = alpha::one`
        )
      ],
      builtins
    )

    const beta = scripts["beta"]
    if (beta === undefined) {
      throw new Error("expected script 'beta'")
    }

    const copied = beta.resolved.members["copied"]
    if (copied?._tag !== "Typed" || copied.type._tag !== "DataType") {
      throw new Error("expected 'copied' to be a Typed DataType")
    }

    expect(Untyped.pathToString(copied.type.path)).toBe("Int")
  })

  it("resolves typed assignments and references across statements", () => {
    const scripts = parseScripts(
      [
        source(
          "functions.hl",
          `module functions export id: Int = 1 + 1; export one = id`
        )
      ],
      builtins
    )

    const functions = scripts["functions"]
    if (functions === undefined) {
      throw new Error("expected script 'functions'")
    }

    const id = functions.resolved.members["id"]
    const one = functions.resolved.members["one"]

    if (id?._tag !== "Typed" || id.type._tag !== "DataType") {
      throw new Error("expected 'id' to be a Typed DataType")
    }
    if (one?._tag !== "Typed" || one.type._tag !== "DataType") {
      throw new Error("expected 'one' to be a Typed DataType")
    }

    expect(Untyped.pathToString(id.type.path)).toBe("Int")
    expect(Untyped.pathToString(one.type.path)).toBe("Int")
  })

  it("resolves exported List[Bool] declaration", () => {
    const scripts = parseScripts(
      [source("list-bool.hl", `module listBool; export xs: List[Bool];`)],
      builtins
    )

    const listBool = scripts["listBool"]
    if (listBool === undefined) {
      throw new Error("expected script 'listBool'")
    }

    const xs = listBool.resolved.members["xs"]
    if (xs?._tag !== "Typed" || xs.type._tag !== "DataType") {
      throw new Error("expected 'xs' to be a Typed DataType")
    }

    expect(pathToString(xs.type.path)).toBe("List[Bool]")
  })

  it("resolves exported type alias of List[Bool]", () => {
    const scripts = parseScripts(
      [source("aliases.hl", `module aliases; export FlagList = List[Bool]`)],
      builtins
    )

    const aliases = scripts["aliases"]
    if (aliases === undefined) {
      throw new Error("expected script 'aliases'")
    }

    const flagList = aliases.resolved.members["FlagList"]
    if (flagList?._tag !== "DataType") {
      throw new Error("expected 'FlagList' to be a DataType")
    }

    expect(pathToString(flagList.path)).toBe("List[Bool]")
  })

  it("resolves switch applications to typed functions", () => {
    const scripts = parseScripts(
      [
        source(
          "switch.hl",
          `module switchy; Choice = enum {Ok; Err}; export choose = switch {Ok -> 1, Err -> 0}[Choice]`
        )
      ],
      builtins
    )

    const switchy = scripts["switchy"]
    if (switchy === undefined) {
      throw new Error("expected script 'switchy'")
    }

    const choose = switchy.resolved.members["choose"]
    if (choose?._tag !== "Typed" || choose.type._tag !== "FuncType") {
      throw new Error("expected 'choose' to be a Typed FuncType")
    }

    const [argType] = choose.type.args
    if (
      argType?._tag !== "DataType" ||
      choose.type.returns._tag !== "DataType"
    ) {
      throw new Error("expected switch function signature to use DataTypes")
    }

    expect(choose.type.args).toHaveLength(1)
    expect(pathToString(argType.path)).toBe("switchy::Choice")
    expect(pathToString(choose.type.returns.path)).toBe("Int")
  })

  it("throws when switch branches return incompatible types", () => {
    expect(() =>
      parseScripts(
        [
          source(
            "switch-mismatch.hl",
            `module switchMismatch; export choose = switch {Ok -> 1, Err -> true}`
          )
        ],
        builtins
      )
    ).toThrow(/Switch branches must return compatible types/)
  })

  it("resolves supported equality expressions to Bool", () => {
    const scripts = parseScripts(
      [source("eq.hl", `module eq; export ok = 1 == 1`)],
      builtins
    )

    const eq = scripts["eq"]
    if (eq === undefined) {
      throw new Error("expected script 'eq'")
    }

    const ok = eq.resolved.members["ok"]
    if (ok?._tag !== "Typed" || ok.type._tag !== "DataType") {
      throw new Error("expected 'ok' to be a Typed DataType")
    }

    expect(pathToString(ok.type.path)).toBe("Bool")
  })

  it("throws on unsupported equality types", () => {
    expect(() =>
      parseScripts(
        [source("eq-real.hl", `module eqReal; export bad = 1.0 == 1.0`)],
        builtins
      )
    ).toThrow(/Unsupported equality type Real/)
  })

  it("resolves Data casts using datatype from_data", () => {
    const scripts = parseScripts(
      [
        source(
          "cast.hl",
          `module cast; value: Data; export one = value as Int`
        )
      ],
      {
        ...builtins,
        Data: dataType("Data", undefined, {
          ir: "(data) -> {data}",
          deps: []
        })
      }
    )

    const cast = scripts["cast"]
    if (cast === undefined) {
      throw new Error("expected script 'cast'")
    }

    const one = cast.resolved.members["one"]
    if (one?._tag !== "Typed" || one.type._tag !== "DataType") {
      throw new Error("expected 'one' to be a Typed DataType")
    }

    expect(pathToString(one.type.path)).toBe("Int")
  })

  it("throws when rhs of as is Data", () => {
    expect(() =>
      parseScripts(
        [source("cast-data.hl", `module castData; value: Data; export bad = value as Data`)],
        {
          ...builtins,
          Data: dataType("Data", undefined, {
            ir: "(data) -> {data}",
            deps: []
          })
        }
      )
    ).toThrow(/does not support Data on the rhs/)
  })

  it("throws when rhs datatype is missing from_data", () => {
    expect(() =>
      parseScripts(
        [source("cast-list.hl", `module castList; value: Data; export bad = value as List[Bool]`)],
        {
          ...builtins,
          Data: dataType("Data", undefined, {
            ir: "(data) -> {data}",
            deps: []
          })
        }
      )
    ).toThrow(/Missing from_data for List\[Bool\]/)
  })

  it("lowers pipes into inferred generic calls", () => {
    const scripts = parseScripts(
      [source("pipe.hl", `module pipe; export first = true | pipeId`)],
      builtins
    )

    const pipe = scripts["pipe"]
    if (pipe === undefined) {
      throw new Error("expected script 'pipe'")
    }

    const stmt = pipe.statements[0]
    expect(stmt?._tag).toBe("Assign")
    if (stmt?._tag !== "Assign") {
      throw new Error("expected Assign statement")
    }

    expect(stmt.rhs._tag).toBe("Call")
    if (stmt.rhs._tag !== "Call") {
      throw new Error("expected pipe rhs to lower to Call")
    }

    expect(stmt.rhs.fn._tag).toBe("Apply")
    if (stmt.rhs.fn._tag !== "Apply") {
      throw new Error("expected generic pipe rhs to lower to Apply")
    }

    expect(stmt.rhs.fn.args.fields).toHaveLength(1)
    const typeArg = stmt.rhs.fn.args.fields[0]
    expect(typeArg._tag).toBe("Reference")
    if (typeArg._tag !== "Reference") {
      throw new Error("expected inferred type arg to be a Reference")
    }

    expect(pathToString(typeArg.path)).toBe("Bool")
    expect(stmt.rhs.resolved.type._tag).toBe("DataType")
    if (stmt.rhs.resolved.type._tag !== "DataType") {
      throw new Error("expected pipe result to be a DataType")
    }

    expect(pathToString(stmt.rhs.resolved.type.path)).toBe("Bool")
  })
})
