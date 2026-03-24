import * as Applied from "./Applied.js"
import * as CompilerError from "./CompilerError.js"
import * as IR from "./IR.js"
import * as Typed from "./Typed.js"
import * as Untyped from "./Untyped.js"
import * as Uplc from "./Uplc.js"
import * as Source from "./Source.js"

export type CompileOptions = {
  compileFunctions?: boolean | undefined
  positionalParams?: readonly string[] | undefined
}

export const compile = (
  src: string | Source.Source | string[] | Source.Source[],
  options: CompileOptions = {}
): Record<string, Uplc.Script> => {
  const normalized = normalizeSources(src)

  const globals = makeGlobals()
  const globalScope: Typed.Scope = Object.fromEntries(
    Object.entries(globals).map(([key, { symbolValue }]) => [key, symbolValue])
  )
  const globalImpls = Applied.makeBuiltins(globals)

  const untypedScripts = normalized.map(Untyped.parseScript)
  const typedScripts = Typed.resolveScripts(untypedScripts, globalScope)
  const entryPoints = Applied.buildEntryPoints(typedScripts, {
    builtins: globalImpls,
    compileFunctions: options.compileFunctions,
    positionalParams: options.positionalParams
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

  const makeDataType = (
    name: string,
    from_data?: Typed.DataType["from_data"]
  ): Typed.DataType => ({
    _tag: "DataType",
    path: makePath(name),
    properties: {},
    variants: {},
    ...(from_data === undefined ? {} : { from_data })
  })

  const makeFunc = (
    name: string,
    args: Typed.Type[],
    returns: Typed.Type
  ): Applied.Globals[string] => ({
    symbolValue: {
      _tag: "Typed",
      path: makePath(name),
      type: {
        _tag: "FuncType",
        args,
        returns
      }
    }
  })

  const boolFromData = {
    ir: "(data) -> {equalsInteger(fstPair(unConstrData(data)),1)}",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>
  const intFromData = {
    ir: "unIData",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>
  const byteArrayFromData = {
    ir: "unBData",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>
  const stringFromData = {
    ir: "(data) -> {decodeUtf8(unBData(data))}",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>
  const realFromData = {
    ir: "unIData",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>
  const dataFromData = {
    ir: "(data) -> {data}",
    deps: []
  } satisfies NonNullable<Typed.DataType["from_data"]>

  const boolType = makeDataType("Bool", boolFromData)
  const intType = makeDataType("Int", intFromData)
  const byteArrayType = makeDataType("ByteArray", byteArrayFromData)
  const realType = makeDataType("Real", realFromData)
  const stringType = makeDataType("String", stringFromData)
  const unitType = makeDataType("Unit")
  const errorUnitType = {
    ...unitType,
    isError: true
  }
  const dataType = makeDataType("Data", dataFromData)
  const bls12_381_G1ElementType = makeDataType("Bls12_381_G1Element")
  const bls12_381_G2ElementType = makeDataType("Bls12_381_G2Element")
  const bls12_381_MlResultType = makeDataType("Bls12_381_MlResult")

  const listGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 1,
    type: ([item]) => ({
      _tag: "DataType",
      path: {
        ...makePath("List"),
        appliedTypes: [item]
      },
      properties: {},
      variants: {},
      from_data: {
        ir: item.path.names[0].value == "Pair" ? "unMapData" : "unListData",
        deps: []
      }
    })
  }

  const pairGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 2,
    type: ([first, second]) => {
      if (first.from_data === undefined) {
        throw new Error(`${Typed.pathToString(first.path)}:::from_data not defined`)
      }

      if (second.from_data === undefined) {
        throw new Error(`${Typed.pathToString(second.path)}:::from_data not defined`)
      }

      return {
        _tag: "DataType",
        path: {
          ...makePath("Pair"),
          appliedTypes: [first, second]
        },
        properties: {
          first: {
            symbolValue: first,
            implementation: {
              ir: Typed.pathToString(first.path) == "Data" ? "fstPair" : `(self) -> {${first.from_data.ir}(fstPair(self))}`,
              deps: first.from_data.deps
            }
          },
          second: {
            symbolValue: second,
            implementation: {
              ir: Typed.pathToString(second.path) == "Data" ? "sndPair" : `(self) -> {${second.from_data.ir}(sndPair(self))}`,
              deps: second.from_data.deps
            }
          }
        },
        variants: {}
      }
    }
  }

  const fstPairGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 2,
    inferCall: ([pair]) => {
      const [first, second] = pair.path.appliedTypes ?? []

      if (first === undefined || second === undefined) {
        throw new Error("fstPair() expects a pair argument")
      }

      return [first, second]
    },
    type: ([first, second]) => ({
      _tag: "Typed",
      path: makePath("fstPair"),
      type: {
        _tag: "FuncType",
        args: [pairOf(first, second)],
        returns: first
      }
    })
  }

  const sndPairGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 2,
    inferCall: ([pair]) => {
      const [first, second] = pair.path.appliedTypes ?? []

      if (first === undefined || second === undefined) {
        throw new Error("sndPair() expects a pair argument")
      }

      return [first, second]
    },
    type: ([first, second]) => ({
      _tag: "Typed",
      path: makePath("sndPair"),
      type: {
        _tag: "FuncType",
        args: [pairOf(first, second)],
        returns: second
      }
    })
  }

  const headListGeneric: Typed.GenericValue = {
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
        args: [listOf(item)],
        returns: item
      }
    })
  }

  const tailListGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 1,
    inferCall: ([list], sourceSpan: Source.Span) => {
      const item = list.path.appliedTypes?.[0]

      if (item === undefined) {
        throw new CompilerError.Type(sourceSpan, "tailList() expects a list argument")
      }

      return [item]
    },
    type: ([item]) => ({
      _tag: "Typed",
      path: makePath("tailList"),
      type: {
        _tag: "FuncType",
        args: [listOf(item)],
        returns: listOf(item)
      }
    })
  }

  const nullListGeneric: Typed.GenericValue = {
    _tag: "GenericValue",
    nArgs: 1,
    inferCall: ([list]) => {
      const item = list.path.appliedTypes?.[0]

      if (item === undefined) {
        throw new Error("nullList() expects a list argument")
      }

      return [item]
    },
    type: ([item]) => ({
      _tag: "Typed",
      path: makePath("nullList"),
      type: {
        _tag: "FuncType",
        args: [listOf(item)],
        returns: boolType
      }
    })
  }

  const listOf = (item: Typed.DataType): Typed.DataType =>
    listGeneric.type([item]) as Typed.DataType

  const pairOf = (
    first: Typed.DataType,
    second: Typed.DataType
  ): Typed.DataType => pairGeneric.type([first, second]) as Typed.DataType

  const dataListType = listOf(dataType)
  const dataPairType = pairOf(dataType, dataType)
  const dataPairListType = listOf(dataPairType)
  const unConstrDataType = pairOf(intType, dataListType)

  return {
    Bool: {
      symbolValue: boolType
    },
    Int: { symbolValue: intType },
    ByteArray: { symbolValue: byteArrayType },
    String: { symbolValue: stringType },
    Real: { symbolValue: realType },
    Unit: { symbolValue: unitType },
    Data: { symbolValue: dataType },
    error: {
      ...makeFunc("error", [], errorUnitType),
      implementation: {
        ir: "() -> {error()}",
        deps: []
      }
    },
    Bls12_381_G1Element: { symbolValue: bls12_381_G1ElementType },
    Bls12_381_G2Element: { symbolValue: bls12_381_G2ElementType },
    Bls12_381_MlResult: { symbolValue: bls12_381_MlResultType },
    List: { symbolValue: listGeneric },
    Pair: { symbolValue: pairGeneric },
    scriptContextData: { symbolValue: { _tag: "Typed", type: dataType } },
    addInteger: makeFunc("addInteger", [intType, intType], intType),
    subtractInteger: makeFunc("subtractInteger", [intType, intType], intType),
    multiplyInteger: makeFunc("multiplyInteger", [intType, intType], intType),
    divideInteger: makeFunc("divideInteger", [intType, intType], intType),
    quotientInteger: makeFunc("quotientInteger", [intType, intType], intType),
    remainderInteger: makeFunc("remainderInteger", [intType, intType], intType),
    modInteger: makeFunc("modInteger", [intType, intType], intType),
    equalsInteger: makeFunc("equalsInteger", [intType, intType], boolType),
    lessThanInteger: makeFunc("lessThanInteger", [intType, intType], boolType),
    lessThanEqualsInteger: makeFunc(
      "lessThanEqualsInteger",
      [intType, intType],
      boolType
    ),
    appendByteString: makeFunc(
      "appendByteString",
      [byteArrayType, byteArrayType],
      byteArrayType
    ),
    consByteString: makeFunc(
      "consByteString",
      [intType, byteArrayType],
      byteArrayType
    ),
    sliceByteString: makeFunc(
      "sliceByteString",
      [intType, intType, byteArrayType],
      byteArrayType
    ),
    lengthOfByteString: makeFunc(
      "lengthOfByteString",
      [byteArrayType],
      intType
    ),
    indexByteString: makeFunc(
      "indexByteString",
      [byteArrayType, intType],
      intType
    ),
    equalsByteString: makeFunc(
      "equalsByteString",
      [byteArrayType, byteArrayType],
      boolType
    ),
    lessThanByteString: makeFunc(
      "lessThanByteString",
      [byteArrayType, byteArrayType],
      boolType
    ),
    lessThanEqualsByteString: makeFunc(
      "lessThanEqualsByteString",
      [byteArrayType, byteArrayType],
      boolType
    ),
    sha2_256: makeFunc("sha2_256", [byteArrayType], byteArrayType),
    sha3_256: makeFunc("sha3_256", [byteArrayType], byteArrayType),
    blake2b_256: makeFunc("blake2b_256", [byteArrayType], byteArrayType),
    verifyEd25519Signature: makeFunc(
      "verifyEd25519Signature",
      [byteArrayType, byteArrayType, byteArrayType],
      boolType
    ),
    appendString: makeFunc(
      "appendString",
      [stringType, stringType],
      stringType
    ),
    equalsString: makeFunc("equalsString", [stringType, stringType], boolType),
    encodeUtf8: makeFunc("encodeUtf8", [stringType], byteArrayType),
    decodeUtf8: makeFunc("decodeUtf8", [byteArrayType], stringType),
    ifThenElse: makeFunc(
      "ifThenElse",
      [boolType, dataType, dataType],
      dataType
    ),
    chooseUnit: makeFunc("chooseUnit", [unitType, dataType], dataType),
    trace: makeFunc("trace", [stringType, dataType], dataType),
    fstPair: { symbolValue: fstPairGeneric },
    sndPair: { symbolValue: sndPairGeneric },
    chooseList: makeFunc(
      "chooseList",
      [dataListType, dataType, dataType],
      dataType
    ),
    mkCons: makeFunc("mkCons", [dataType, dataListType], dataListType),
    headList: { symbolValue: headListGeneric },
    tailList: { symbolValue: tailListGeneric },
    nullList: { symbolValue: nullListGeneric },
    chooseData: makeFunc(
      "chooseData",
      [dataType, dataType, dataType, dataType, dataType, dataType],
      dataType
    ),
    constrData: makeFunc("constrData", [intType, dataListType], dataType),
    mapData: makeFunc("mapData", [dataPairListType], dataType),
    listData: makeFunc("listData", [dataListType], dataType),
    iData: makeFunc("iData", [intType], dataType),
    bData: makeFunc("bData", [byteArrayType], dataType),
    unConstrData: makeFunc("unConstrData", [dataType], unConstrDataType),
    unMapData: makeFunc("unMapData", [dataType], dataPairListType),
    unListData: makeFunc("unListData", [dataType], dataListType),
    unIData: makeFunc("unIData", [dataType], intType),
    unBData: makeFunc("unBData", [dataType], byteArrayType),
    equalsData: makeFunc("equalsData", [dataType, dataType], boolType),
    mkPairData: makeFunc("mkPairData", [dataType, dataType], dataPairType),
    mkNilData: makeFunc("mkNilData", [unitType], dataListType),
    mkNilPairData: makeFunc("mkNilPairData", [unitType], dataPairListType),
    serialiseData: makeFunc("serialiseData", [dataType], byteArrayType),
    verifyEcdsaSecp256k1Signature: makeFunc(
      "verifyEcdsaSecp256k1Signature",
      [byteArrayType, byteArrayType, byteArrayType],
      boolType
    ),
    verifySchnorrSecp256k1Signature: makeFunc(
      "verifySchnorrSecp256k1Signature",
      [byteArrayType, byteArrayType, byteArrayType],
      boolType
    ),
    bls12_381_G1_add: makeFunc(
      "bls12_381_G1_add",
      [bls12_381_G1ElementType, bls12_381_G1ElementType],
      bls12_381_G1ElementType
    ),
    bls12_381_G1_neg: makeFunc(
      "bls12_381_G1_neg",
      [bls12_381_G1ElementType],
      bls12_381_G1ElementType
    ),
    bls12_381_G1_scalarMul: makeFunc(
      "bls12_381_G1_scalarMul",
      [intType, bls12_381_G1ElementType],
      bls12_381_G1ElementType
    ),
    bls12_381_G1_equal: makeFunc(
      "bls12_381_G1_equal",
      [bls12_381_G1ElementType, bls12_381_G1ElementType],
      boolType
    ),
    bls12_381_G1_hashToGroup: makeFunc(
      "bls12_381_G1_hashToGroup",
      [byteArrayType, byteArrayType],
      bls12_381_G1ElementType
    ),
    bls12_381_G1_compress: makeFunc(
      "bls12_381_G1_compress",
      [bls12_381_G1ElementType],
      byteArrayType
    ),
    bls12_381_G1_uncompress: makeFunc(
      "bls12_381_G1_uncompress",
      [byteArrayType],
      bls12_381_G1ElementType
    ),
    bls12_381_G2_add: makeFunc(
      "bls12_381_G2_add",
      [bls12_381_G2ElementType, bls12_381_G2ElementType],
      bls12_381_G2ElementType
    ),
    bls12_381_G2_neg: makeFunc(
      "bls12_381_G2_neg",
      [bls12_381_G2ElementType],
      bls12_381_G2ElementType
    ),
    bls12_381_G2_scalarMul: makeFunc(
      "bls12_381_G2_scalarMul",
      [intType, bls12_381_G2ElementType],
      bls12_381_G2ElementType
    ),
    bls12_381_G2_equal: makeFunc(
      "bls12_381_G2_equal",
      [bls12_381_G2ElementType, bls12_381_G2ElementType],
      boolType
    ),
    bls12_381_G2_hashToGroup: makeFunc(
      "bls12_381_G2_hashToGroup",
      [byteArrayType, byteArrayType],
      bls12_381_G2ElementType
    ),
    bls12_381_G2_compress: makeFunc(
      "bls12_381_G2_compress",
      [bls12_381_G2ElementType],
      byteArrayType
    ),
    bls12_381_G2_uncompress: makeFunc(
      "bls12_381_G2_uncompress",
      [byteArrayType],
      bls12_381_G2ElementType
    ),
    bls12_381_millerLoop: makeFunc(
      "bls12_381_millerLoop",
      [bls12_381_G1ElementType, bls12_381_G2ElementType],
      bls12_381_MlResultType
    ),
    bls12_381_mulMlResult: makeFunc(
      "bls12_381_mulMlResult",
      [bls12_381_MlResultType, bls12_381_MlResultType],
      bls12_381_MlResultType
    ),
    bls12_381_finalVerify: makeFunc(
      "bls12_381_finalVerify",
      [bls12_381_MlResultType, bls12_381_MlResultType],
      boolType
    ),
    keccak_256: makeFunc("keccak_256", [byteArrayType], byteArrayType),
    blake2b_224: makeFunc("blake2b_224", [byteArrayType], byteArrayType),
    integerToByteString: makeFunc(
      "integerToByteString",
      [boolType, intType, intType],
      byteArrayType
    ),
    byteStringToInteger: makeFunc(
      "byteStringToInteger",
      [boolType, byteArrayType],
      intType
    )
  }
}
