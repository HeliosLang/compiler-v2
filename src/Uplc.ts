import * as Flat from "./Flat.js"

export interface Script {
  version: 3
  root: Uint8Array
  verbose: Uint8Array
}

export type IntData = {
  readonly int: bigint
}

export type ByteArrayData = {
  readonly bytes: Uint8Array
}

export type ConstrData = {
  readonly constructor: number
  readonly fields: ReadonlyArray<Data>
}

export type ListData = {
  readonly list: ReadonlyArray<Data>
}

export type MapData = {
  readonly map: ReadonlyArray<{ k: Data; v: Data }>
}

export type Data = IntData | ByteArrayData | ConstrData | ListData | MapData

export interface BoolValue {
  _tag: "Bool"
  value: boolean
}

export interface ByteArrayValue {
  _tag: "ByteArray"
  value: Uint8Array
}

export interface DataValue {
  _tag: "Data"
  value: Data
}

export interface IntValue {
  _tag: "Int"
  value: bigint
}

export interface ListValue {
  readonly _tag: "List"
  readonly itemType: string // eg. 0100
  readonly items: ReadonlyArray<Value>
}

export interface PairValue {
  readonly _tag: "Pair"
  readonly first: Value
  readonly second: Value
}

export interface StringValue {
  _tag: "String"
  value: string
}

export interface UnitValue {
  _tag: "Unit"
}

export type Value =
  | BoolValue
  | ByteArrayValue
  | DataValue
  | IntValue
  | ListValue
  | PairValue
  | StringValue
  | UnitValue

export interface SourceSpan {
  file: string
  start: {
    line: number
    column: number
  }
  end?: {
    line: number
    column: number
  }
}

export interface Apply {
  _tag: "Apply"
  fn: Term
  arg: Term
  sourceSpan?: SourceSpan | undefined
}

export interface Builtin {
  _tag: "Builtin"
  id: number
  name?: string | undefined
  sourceSpan?: SourceSpan | undefined
}

export interface Case {
  _tag: "Case"
  arg: Term
  cases: readonly Term[]
  sourceSpan?: SourceSpan | undefined
}

export interface Const {
  _tag: "Const"
  value: Value
  name?: string | undefined
  sourceSpan?: SourceSpan | undefined
}

export interface Constr {
  _tag: "Constr"
  tag: number
  args: readonly Term[]
  sourceSpan?: SourceSpan | undefined
}

export interface Delay {
  _tag: "Delay"
  arg: Term
  sourceSpan?: SourceSpan | undefined
  name?: string | undefined
}

export interface Error {
  _tag: "Error"
  sourceSpan?: SourceSpan | undefined
}

export interface Force {
  _tag: "Force"
  arg: Term
  sourceSpan?: SourceSpan | undefined
}

export interface Lambda {
  _tag: "Lambda"
  body: Term
  argName?: string | undefined
  sourceSpan?: SourceSpan | undefined
  name?: string | undefined
}

export interface Var {
  _tag: "Var"
  index: number
  name?: string | undefined
  sourceSpan?: SourceSpan | undefined
}

export type Term =
  | Apply
  | Builtin
  | Case
  | Const
  | Constr
  | Delay
  | Error
  | Force
  | Lambda
  | Var

export type BuiltinName = {
  name: string
  nForces: number
}

export const BUILTIN_NAMES: BuiltinName[] = [
  { name: "addInteger", nForces: 0 },
  { name: "subtractInteger", nForces: 0 },
  { name: "multiplyInteger", nForces: 0 },
  { name: "divideInteger", nForces: 0 },
  { name: "quotientInteger", nForces: 0 },
  { name: "remainderInteger", nForces: 0 },
  { name: "modInteger", nForces: 0 },
  { name: "equalsInteger", nForces: 0 },
  { name: "lessThanInteger", nForces: 0 },
  { name: "lessThanEqualsInteger", nForces: 0 },
  { name: "appendByteString", nForces: 0 },
  { name: "consByteString", nForces: 0 },
  { name: "sliceByteString", nForces: 0 },
  { name: "lengthOfByteString", nForces: 0 },
  { name: "indexByteString", nForces: 0 },
  { name: "equalsByteString", nForces: 0 },
  { name: "lessThanByteString", nForces: 0 },
  { name: "lessThanEqualsByteString", nForces: 0 },
  { name: "sha2_256", nForces: 0 },
  { name: "sha3_256", nForces: 0 },
  { name: "blake2b_256", nForces: 0 },
  { name: "verifyEd25519Signature", nForces: 0 },
  { name: "appendString", nForces: 0 },
  { name: "equalsString", nForces: 0 },
  { name: "encodeUtf8", nForces: 0 },
  { name: "decodeUtf8", nForces: 0 },
  { name: "ifThenElse", nForces: 1 },
  { name: "chooseUnit", nForces: 1 },
  { name: "trace", nForces: 1 },
  { name: "fstPair", nForces: 2 },
  { name: "sndPair", nForces: 2 },
  { name: "chooseList", nForces: 2 },
  { name: "mkCons", nForces: 1 },
  { name: "headList", nForces: 1 },
  { name: "tailList", nForces: 1 },
  { name: "nullList", nForces: 1 },
  { name: "chooseData", nForces: 1 },
  { name: "constrData", nForces: 0 },
  { name: "mapData", nForces: 0 },
  { name: "listData", nForces: 0 },
  { name: "iData", nForces: 0 },
  { name: "bData", nForces: 0 },
  { name: "unConstrData", nForces: 0 },
  { name: "unMapData", nForces: 0 },
  { name: "unListData", nForces: 0 },
  { name: "unIData", nForces: 0 },
  { name: "unBData", nForces: 0 },
  { name: "equalsData", nForces: 0 },
  { name: "mkPairData", nForces: 0 },
  { name: "mkNilData", nForces: 0 },
  { name: "mkNilPairData", nForces: 0 },
  { name: "serialiseData", nForces: 0 },
  { name: "verifyEcdsaSecp256k1Signature", nForces: 0 },
  { name: "verifySchnorrSecp256k1Signature", nForces: 0 },
  { name: "bls12_381_G1_add", nForces: 0 },
  { name: "bls12_381_G1_neg", nForces: 0 },
  { name: "bls12_381_G1_scalarMul", nForces: 0 },
  { name: "bls12_381_G1_equal", nForces: 0 },
  { name: "bls12_381_G1_hashToGroup", nForces: 0 },
  { name: "bls12_381_G1_compress", nForces: 0 },
  { name: "bls12_381_G1_uncompress", nForces: 0 },
  { name: "bls12_381_G2_add", nForces: 0 },
  { name: "bls12_381_G2_neg", nForces: 0 },
  { name: "bls12_381_G2_scalarMul", nForces: 0 },
  { name: "bls12_381_G2_equal", nForces: 0 },
  { name: "bls12_381_G2_hashToGroup", nForces: 0 },
  { name: "bls12_381_G2_compress", nForces: 0 },
  { name: "bls12_381_G2_uncompress", nForces: 0 },
  { name: "bls12_381_millerLoop", nForces: 0 },
  { name: "bls12_381_mulMlResult", nForces: 0 },
  { name: "bls12_381_finalVerify", nForces: 0 },
  { name: "keccak_256", nForces: 0 },
  { name: "blake2b_224", nForces: 0 },
  { name: "integerToByteString", nForces: 0 },
  { name: "byteStringToInteger", nForces: 0 }
]

export const ApplyTag = 3
export const BuiltinTag = 7
export const CaseTag = 9
export const ConstTag = 4
export const ConstrTag = 8
export const DelayTag = 1
export const ErrorTag = 6
export const ForceTag = 5
export const LambdaTag = 2
export const VarTag = 0

export function flatTag(term: Term): number {
  switch (term._tag) {
    case "Apply":
      return ApplyTag
    case "Builtin":
      return BuiltinTag
    case "Case":
      return CaseTag
    case "Const":
      return ConstTag
    case "Constr":
      return ConstrTag
    case "Delay":
      return DelayTag
    case "Error":
      return ErrorTag
    case "Force":
      return ForceTag
    case "Lambda":
      return LambdaTag
    case "Var":
      return VarTag
  }
}

export const encodeRoot = (
  uplcVersion: "1.0.0" | "1.1.0",
  term: Term
): Uint8Array => {
  const w = Flat.makeWriter()

  uplcVersion.split(".").forEach((v) => {
    w.writeInt(Number(v))
  })

  encode(w)(term)

  return Uint8Array.from(w.finalize())
}

export const encode =
  (w: Flat.Writer) =>
  (term: Term): void => {
    const pending: (
      | {
          kind: "notInList"
          term: Term
        }
      | {
          kind: "listItem"
          term: Term
        }
      | {
          kind: "listEnd"
        }
    )[] = [
      {
        kind: "notInList",
        term
      }
    ]

    let action = pending.pop()

    while (action) {
      if (action.kind == "listItem" || action.kind == "notInList") {
        if (action.kind == "listItem") {
          w.writeListCons()
        }

        const t = action.term

        switch (t._tag) {
          case "Builtin":
            w.writeTermTag(BuiltinTag)
            w.writeBuiltinId(t.id)
            break
          case "Apply":
            w.writeTermTag(ApplyTag)
            pending.push({ kind: "notInList", term: t.arg })
            pending.push({ kind: "notInList", term: t.fn })
            break
          case "Case":
            w.writeTermTag(CaseTag)
            pending.push({ kind: "listEnd" })
            for (let i = t.cases.length - 1; i >= 0; i--) {
              pending.push({ kind: "listItem", term: t.cases[i] })
            }
            pending.push({ kind: "notInList", term: t.arg })
            break
          case "Const":
            w.writeTermTag(ConstTag)
            w.writeTypeBits(valueToType(t.value))
            valueToFlat(w, t.value)
            break
          case "Constr":
            w.writeTermTag(ConstrTag)
            w.writeInt(t.tag)
            pending.push({ kind: "listEnd" })
            for (let i = t.args.length - 1; i >= 0; i--) {
              pending.push({ kind: "listItem", term: t.args[i] })
            }
            break
          case "Delay":
            w.writeTermTag(DelayTag)
            pending.push({ kind: "notInList", term: t.arg })
            break
          case "Error":
            w.writeTermTag(ErrorTag)
            break
          case "Force":
            w.writeTermTag(ForceTag)
            pending.push({ kind: "notInList", term: t.arg })
            break
          case "Lambda":
            w.writeTermTag(LambdaTag)
            pending.push({ kind: "notInList", term: t.body })
            break
          case "Var":
            w.writeTermTag(VarTag)
            w.writeInt(BigInt(t.index))
            break
        }
      } else {
        w.writeListNil()
      }

      action = pending.pop()
    }
  }

const IntType = "0000"
const ByteArrayType = "0001"
const StringType = "0010"
const UnitType = "0011"
const BoolType = "0100"
const DataType = "1000"
const ContainerType = "0111"
const ListType = "0101"
const PairType = "0110"

function valueToType(value: Value): string {
  switch (value._tag) {
    case "Bool":
      return BoolType
    case "ByteArray":
      return ByteArrayType
    case "Data":
      return DataType
    case "Int":
      return IntType
    case "List":
      return listType(value.itemType)
    case "Pair":
      return pairType(valueToType(value.first), valueToType(value.second))
    case "String":
      return StringType
    case "Unit":
      return UnitType
  }
}

function listType(itemType: string): string {
  return [ContainerType, ListType, itemType].join("1")
}

function pairType(first: string, second: string): string {
  return [ContainerType, ContainerType, PairType, first, second].join("1")
}

function valueToFlat(w: Flat.Writer, value: Value): void {
  switch (value._tag) {
    case "Bool":
      w.writeBool(value.value)
      break
    case "ByteArray":
      w.writeBytes(value.value)
      break
    case "Data":
      w.writeBytes(encodeData(value.value))
      break
    case "Int":
      w.writeInt(zigZagToUnsigned(value.value))
      break
    case "List":
      value.items.forEach((item) => {
        w.writeListCons()
        valueToFlat(w, item)
      })
      w.writeListNil()
      break
    case "Pair":
      valueToFlat(w, value.first)
      valueToFlat(w, value.second)
      break
    case "String":
      w.writeBytes(new TextEncoder().encode(value.value))
      break
    case "Unit":
      break
  }
}

function zigZagToUnsigned(x: bigint): bigint {
  return x < 0n ? -x * 2n - 1n : x * 2n
}

function encodeData(data: Data): number[] {
  if ("bytes" in data) {
    return encodeCborBytes(data.bytes, true)
  } else if ("fields" in data) {
    return encodeCborConstr(data.constructor, data.fields.map(encodeData))
  } else if ("int" in data) {
    return encodeCborInt(data.int)
  } else if ("list" in data) {
    return encodeCborList(data.list.map(encodeData))
  } else if ("map" in data) {
    return encodeCborMap(
      data.map.map(({ k, v }) => [encodeData(k), encodeData(v)] as const)
    )
  } else {
    throw new Error("Unrecognized Uplc.Data type")
  }
}

function encodeCborConstr(tag: number, fields: readonly number[][]): number[] {
  return encodeConstrTag(tag).concat(encodeCborList(fields))
}

function encodeConstrTag(tag: number): number[] {
  if (tag < 0 || tag % 1 != 0) {
    throw new Error("invalid tag")
  } else if (tag <= 6) {
    return encodeDefHead(6, 121n + BigInt(tag))
  } else if (tag <= 127) {
    return encodeDefHead(6, 1280n + BigInt(tag - 7))
  } else {
    return encodeDefHead(6, 102n)
      .concat(encodeDefHead(4, 2n))
      .concat(encodeCborInt(BigInt(tag)))
  }
}

function encodeCborBytes(
  bytes: readonly number[] | Uint8Array,
  splitIntoChunks: boolean = false
): number[] {
  const bs = Array.from(bytes)

  if (bs.length <= 64 || !splitIntoChunks) {
    return encodeDefHead(2, BigInt(bs.length)).concat(bs)
  }

  let res = [2 * 32 + 31]
  const remaining = bs.slice()

  while (remaining.length > 0) {
    const chunk = remaining.splice(0, 64)
    res = res.concat(encodeDefHead(2, BigInt(chunk.length)), chunk)
  }

  res.push(255)

  return res
}

function encodeCborList(items: readonly number[][]): number[] {
  if (items.length == 0) {
    return encodeDefHead(4, 0n)
  }

  return [4 * 32 + 31].concat(...items).concat([255])
}

function encodeCborMap(
  pairs: readonly (readonly [number[], number[]])[]
): number[] {
  return encodeDefHead(5, BigInt(pairs.length)).concat(
    ...pairs.map(([k, v]) => k.concat(v))
  )
}

function encodeCborInt(n: bigint | number): number[] {
  const value = typeof n == "number" ? BigInt(n) : n
  const maxWord64 = (2n << 63n) - 1n

  if (value >= 0n && value <= maxWord64) {
    return encodeDefHead(0, value)
  } else if (value >= 2n << 63n) {
    return encodeDefHead(6, 2n).concat(encodeCborBytes(encodeBigEndian(value)))
  } else if (value <= -1n && value >= -(2n << 63n)) {
    return encodeDefHead(1, -value - 1n)
  } else {
    return encodeDefHead(6, 3n).concat(
      encodeCborBytes(encodeBigEndian(-value - 1n))
    )
  }
}

function encodeDefHead(m: number, n: bigint | number): number[] {
  const value = typeof n == "number" ? BigInt(n) : n

  if (value <= 23n) {
    return [32 * m + Number(value)]
  } else if (value <= 255n) {
    return [32 * m + 24, Number(value)]
  } else if (value <= 256n * 256n - 1n) {
    return [32 * m + 25, Number((value / 256n) % 256n), Number(value % 256n)]
  } else if (value <= 256n * 256n * 256n * 256n - 1n) {
    return [32 * m + 26].concat(padBytes(encodeBigEndian(value), 4))
  } else if (
    value <=
    256n * 256n * 256n * 256n * 256n * 256n * 256n * 256n - 1n
  ) {
    return [32 * m + 27].concat(padBytes(encodeBigEndian(value), 8))
  } else {
    throw new Error("n out of range")
  }
}

function encodeBigEndian(value: bigint): number[] {
  if (value < 0n) {
    throw new Error("can't encode negative bigint as big endian")
  }

  if (value == 0n) {
    return [0]
  }

  const bytes: number[] = []
  let remaining = value

  while (remaining > 0n) {
    bytes.unshift(Number(remaining % 256n))
    remaining /= 256n
  }

  return bytes
}

function padBytes(bytes: readonly number[], length: number): number[] {
  const padded = Array.from(bytes)

  while (padded.length < length) {
    padded.unshift(0)
  }

  return padded
}
