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
  readonly items: Value
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

export const BUILTIN_NAMES = [
  "addInteger",
  "subtractInteger",
  "multiplyInteger",
  "divideInteger",
  "quotientInteger",
  "remainderInteger",
  "modInteger",
  "equalsInteger",
  "lessThanInteger",
  "lessThanEqualsInteger",
  "appendByteString",
  "consByteString",
  "sliceByteString",
  "lengthOfByteString",
  "indexByteString",
  "equalsByteString",
  "lessThanByteString",
  "lessThanEqualsByteString",
  "sha2_256",
  "sha3_256",
  "blake2b_256",
  "verifyEd25519Signature",
  "appendString",
  "equalsString",
  "encodeUtf8",
  "decodeUtf8",
  "ifThenElse",
  "chooseUnit",
  "trace",
  "fstPair",
  "sndPair",
  "chooseList",
  "mkCons",
  "headList",
  "tailList",
  "nullList",
  "chooseData",
  "constrData",
  "mapData",
  "listData",
  "iData",
  "bData",
  "unConstrData",
  "unMapData",
  "unListData",
  "unIData",
  "unBData",
  "equalsData",
  "mkPairData",
  "mkNilData",
  "mkNilPairData",
  "serialiseData",
  "verifyEcdsaSecp256k1Signature",
  "verifySchnorrSecp256k1Signature",
  "bls12_381_G1_add",
  "bls12_381_G1_neg",
  "bls12_381_G1_scalarMul",
  "bls12_381_G1_equal",
  "bls12_381_G1_hashToGroup",
  "bls12_381_G1_compress",
  "bls12_381_G1_uncompress",
  "bls12_381_G2_add",
  "bls12_381_G2_neg",
  "bls12_381_G2_scalarMul",
  "bls12_381_G2_equal",
  "bls12_381_G2_hashToGroup",
  "bls12_381_G2_compress",
  "bls12_381_G2_uncompress",
  "bls12_381_millerLoop",
  "bls12_381_mulMlResult",
  "bls12_381_finalVerify",
  "keccak_256",
  "blake2b_224",
  "integerToByteString",
  "byteStringToInteger",
  "andByteString",
  "orByteString",
  "xorByteString",
  "complementByteString",
  "readBit",
  "writeBits",
  "replicateByte",
  "shiftByteString",
  "rotateByteString",
  "countSetBits",
  "findFirstSetBit",
  "ripemd_160",
  "expModInteger"
]
