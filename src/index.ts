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
  const globalScope: Typed.Scope = Object.fromEntries(
    Object.entries(globals).map(([key, { symbolValue }]) => [key, symbolValue])
  )
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

  const makeDataType = (name: string): Typed.DataType => ({
    _tag: "DataType",
    path: makePath(name),
    properties: {},
    variants: {}
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

  const boolType = makeDataType("Bool")
  const intType = makeDataType("Int")
  const byteArrayType = makeDataType("ByteArray")
  const realType = makeDataType("Real")
  const stringType = makeDataType("String")
  const unitType = makeDataType("Unit")
  const dataType = makeDataType("Data")
  const bls12_381_G1ElementType = makeDataType("Bls12_381_G1Element")
  const bls12_381_G2ElementType = makeDataType("Bls12_381_G2Element")
  const bls12_381_MlResultType = makeDataType("Bls12_381_MlResult")

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

  const pairGeneric: Typed.GenericType = {
    _tag: "GenericType",
    nArgs: 2,
    type: ([first, second]) => ({
      _tag: "DataType",
      path: {
        ...makePath("Pair"),
        appliedTypes: [first, second]
      },
      properties: {},
      variants: {}
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
    "Bool:::from_data": {
      ...makeFunc("Bool:::from_data", [dataType], boolType),
      implementation: {
        ir: "(data) -> {equalsInteger(sndPair(unConstrData(data)),1)}",
        deps: []
      }
    },
    Int: { symbolValue: intType },
    "Int:::from_data": {
      ...makeFunc("Int:::from_data", [dataType], intType),
      implementation: {
        ir: "unIData",
        deps: []
      }
    },
    ByteArray: { symbolValue: byteArrayType },
    "ByteArray:::from_data": {
      ...makeFunc("ByteArray:::from_data", [dataType], byteArrayType),
      implementation: {
        ir: "unBData",
        deps: []
      }
    },
    String: { symbolValue: stringType },
    "String:::from_data": {
      ...makeFunc("String:::from_data", [dataType], stringType),
      implementation: {
        ir: "(data) -> {decodeUtf8(unBData(data))}",
        deps: []
      }
    },
    Real: { symbolValue: realType },
    "Real:::from_data": {
      ...makeFunc("Real:::from_data", [dataType], realType),
      implementation: {
        ir: "unIData",
        deps: []
      }
    },
    Unit: { symbolValue: unitType },
    Data: { symbolValue: dataType },
    "Data:::from_data": {
      ...makeFunc("Data:::from_data", [dataType], dataType),
      implementation: {
        ir: "(data) -> {data}",
        deps: []
      }
    },
    Bls12_381_G1Element: { symbolValue: bls12_381_G1ElementType },
    Bls12_381_G2Element: { symbolValue: bls12_381_G2ElementType },
    Bls12_381_MlResult: { symbolValue: bls12_381_MlResultType },
    List: { symbolValue: listGeneric },
    Map: { symbolValue: mapGeneric },
    Pair: { symbolValue: pairGeneric },
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
    fstPair: makeFunc("fstPair", [dataPairType], dataType),
    sndPair: makeFunc("sndPair", [dataPairType], dataType),
    chooseList: makeFunc(
      "chooseList",
      [dataListType, dataType, dataType],
      dataType
    ),
    mkCons: makeFunc("mkCons", [dataType, dataListType], dataListType),
    headList: makeFunc("headList", [dataListType], dataType),
    tailList: makeFunc("tailList", [dataListType], dataListType),
    nullList: makeFunc("nullList", [dataListType], boolType),
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
