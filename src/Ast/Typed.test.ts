import { describe, expect, it } from "bun:test"
import * as Source from "../Source/index.js"
import {
  parseScripts,
  pathToString,
  type DataType,
  type GenericType,
  type Scope,
  type Path,
} from "./Typed.js"
import * as Untyped from "./Untyped.js"

const source = (name: string, content: string) => ({
  name,
  content
})

const makePath = (path: string): Path => Untyped.makePath(Source.DummySpan(), path)

const dataType = (path: string, appliedTypes?: DataType[]): DataType => ({
  _tag: "DataType",
  path:
    appliedTypes === undefined || appliedTypes.length == 0
      ? makePath(path)
      : {
          ...makePath(path),
          appliedTypes
        },
  properties: {},
  variants: {}
})

const listGeneric: GenericType = {
  _tag: "GenericType",
  nArgs: 1,
  type: ([item]) => dataType("List", [item])
}

const mapGeneric: GenericType = {
  _tag: "GenericType",
  nArgs: 2,
  type: ([key, value]) => dataType("Map", [key, value])
}

const builtins: Scope = {
  Bool: dataType("Bool"),
  Int: dataType("Int"),
  ByteArray: dataType("ByteArray"),
  String: dataType("String"),
  Real: dataType("Real"),
  List: listGeneric,
  Map: mapGeneric
}

describe("parseScripts", () => {
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
})
