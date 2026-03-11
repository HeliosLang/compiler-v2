import * as Applied from "./Applied.js"
import * as IR from "./IR.js"
import * as Typed from "./Typed.js"
import * as Untyped from "./Untyped.js"
import * as Uplc from "./Uplc.js"
import * as Source from "./Source.js"

export type CompileOptions = {
  compileFunctions?: boolean | undefined
}

export const compile = (
  src: string | Source.Source | string[] | Source.Source[],
  options: CompileOptions = {}
): Record<string, Uplc.Script> => {
  const normalized = normalizeSources(src)

  const globals = makeGlobals()
  const globalScope: Typed.Scope = Object.fromEntries(Object.entries(globals).map(([key, {symbolValue}]) => ([key, symbolValue])))
  const globalImpls = Applied.makeBuiltins(globals)

  const untypedScripts = normalized.map(Untyped.parseScript)
  const typedScripts = Typed.resolveScripts(untypedScripts, globalScope)
  const entryPoints = Applied.buildEntryPoints(typedScripts, {
    builtins: globalImpls,
    compileFunctions: options.compileFunctions
  })

  const scripts: Record<string, Uplc.Script> = {}

  for (const [name, entryPoint] of Object.entries(entryPoints)) {
    const irExpr = Applied.generateEntryPointIR(entryPoint)
    const uplcTerm = IR.generateUplc(irExpr)
    const root = Uplc.encodeRoot("1.1.0", uplcTerm)

    scripts[name] = {
      version: 3,
      root,
      verbose: root
    }
  }

  return scripts
}

function normalizeSources(
  src: string | Source.Source | string[] | Source.Source[]
): Source.Source[] {
  const srcs: Source.Source[] = Array.isArray(src)
    ? src.map((s) => (typeof s == "string" ? { name: "", content: s } : s))
    : [typeof src == "string" ? { name: "", content: src } : src]

  return srcs.map((s, i) => ({
    name: s.name != "" ? s.name : `source-${i}.hl`,
    content: s.content
  }))
}

function makeGlobals(): Applied.Globals {
  const internalSpan: Source.Span = {
    source: {
      name: "internal",
      content: ""
    },
    start: 0,
    end: 0
  }

  const makePath = (name: string): Typed.Path =>
    Untyped.makePath(internalSpan, name)

  const boolType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("Bool"),
    properties: {},
    variants: {}
  }

  const intType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("Int"),
    properties: {},
    variants: {}
  }

  const byteArrayType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("ByteArray"),
    properties: {},
    variants: {}
  }

  const realType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("Real"),
    properties: {},
    variants: {}
  }

  const stringType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("String"),
    properties: {},
    variants: {}
  }

  const unitType: Typed.DataType = {
    _tag: "DataType",
    path: makePath("Unit"),
    properties: {},
    variants: {}
  }

  const listGeneric: Typed.GenericType = {
    _tag: "GenericType",
    nArgs: 1,
    type: ([item]) => ({
      _tag: "DataType",
      path: {
        ...makePath("List"),
        appliedTypes: [item]
      },
      properties: {},
      variants: {}
    })
  }

  const mapGeneric: Typed.GenericType = {
    _tag: "GenericType",
    nArgs: 2,
    type: ([key, value]) => ({
      _tag: "DataType",
      path: {
        ...makePath("Map"),
        appliedTypes: [key, value]
      },
      properties: {},
      variants: {}
    })
  }

  return {
    Bool: {
      symbolValue: boolType
    },
    Int: {symbolValue: intType},
    ByteArray: {symbolValue: byteArrayType},
    String: {symbolValue: stringType},
    Real: {symbolValue: realType},
    Unit: {symbolValue: unitType},
    List: {symbolValue: listGeneric},
    Map: {symbolValue: mapGeneric},
    indexByteString: {
      symbolValue: {
        _tag: "Typed",
        path: makePath("indexByteString"),
        type: {
          _tag: "FuncType",
          args: [byteArrayType, intType],
          returns: intType
        },
      }
    }
  }
}
