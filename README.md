# `@helios-lang/compiler-v2`

Helios compiler library for compiling Helios source code into UPLC script bytes.

## Installation

```sh
pnpm add @helios-lang/compiler-v2
```

## Public Interface

The package currently exposes a single runtime entrypoint from the package root:

```ts
import { compile } from "@helios-lang/compiler-v2"
```

It also exports the `CompileOptions` TypeScript type:

```ts
import { compile, type CompileOptions } from "@helios-lang/compiler-v2"
```

Internal modules such as `Applied`, `Typed`, `Untyped`, `IR`, `Uplc`, and `Source` are not part of the package root public API.

## `compile()`

```ts
type CompileOptions = {
  compileFunctions?: boolean
  positionalParams?: readonly string[]
}

declare const compile: (
  src:
    | string
    | { name: string; content: string }
    | string[]
    | { name: string; content: string }[],
  options?: CompileOptions
) => Record<
  string,
  {
    version: 3
    root: Uint8Array
    verbose: Uint8Array
  }
>
```

### Inputs

- Pass a single Helios source string for one module.
- Pass `{ name, content }` objects when you want stable source names.
- Pass arrays to compile multiple source files together.

When plain strings are used, the compiler assigns synthetic source names internally.

### Options

- `compileFunctions`
  Enables compilation of exported functions as callable entrypoints. (Not just `main`)
- `positionalParams`
  Marks exported values by fully qualified path, such as `"anchor::SEED"`, as positional parameters.

### Output

`compile()` returns a record keyed by compiled entrypoint path.

Typical keys look like:

- `"fib::fib"`
- `"anchor::main"`

Each value is a compiled UPLC script:

- `version`
  Currently always `3`.
- `root`
  Encoded script bytes.
- `verbose`
  Currently the same encoded bytes as `root`.

## Entrypoint Rules

- Validator scripts export `main`, which is compiled as an entrypoint by default.
- Regular exported functions are only compiled into entrypoints when `compileFunctions: true` is set.
- The returned object only contains compiled entrypoints, not every exported symbol.

## Global Builtins

The compiler injects the following globals into every module.

### Builtin Types

```ts
Bool
Int
ByteArray
String
Real
()
Data
Bls12_381_G1Element
Bls12_381_G2Element
Bls12_381_MlResult
List[T]
Pair[A, B]
```

Notes:

- `List` and `Pair` are generic type constructors.
- The unit type is written as `()` in Helios source, and the only unit value is also `()`. The compiler internals refer to this type as `Unit`.
- `Real` is available as a type, but this package does not currently inject any `Real`-specific global functions.

### Builtin Values

```ts
scriptContextData: Data
```

### Builtin Helpers

```ts
error(msg: String): ()
assert(condition: Bool, msg: String): ()
```

### Integer Builtins

```ts
addInteger(a: Int, b: Int): Int
subtractInteger(a: Int, b: Int): Int
multiplyInteger(a: Int, b: Int): Int
divideInteger(a: Int, b: Int): Int
quotientInteger(a: Int, b: Int): Int
remainderInteger(a: Int, b: Int): Int
modInteger(a: Int, b: Int): Int
equalsInteger(a: Int, b: Int): Bool
lessThanInteger(a: Int, b: Int): Bool
lessThanEqualsInteger(a: Int, b: Int): Bool
```

### ByteArray Builtins

```ts
appendByteString(a: ByteArray, b: ByteArray): ByteArray
consByteString(head: Int, tail: ByteArray): ByteArray
sliceByteString(start: Int, end: Int, bytes: ByteArray): ByteArray
lengthOfByteString(bytes: ByteArray): Int
indexByteString(bytes: ByteArray, index: Int): Int
equalsByteString(a: ByteArray, b: ByteArray): Bool
lessThanByteString(a: ByteArray, b: ByteArray): Bool
lessThanEqualsByteString(a: ByteArray, b: ByteArray): Bool
```

### Cryptography Builtins

```ts
sha2_256(bytes: ByteArray): ByteArray
sha3_256(bytes: ByteArray): ByteArray
blake2b_256(bytes: ByteArray): ByteArray
keccak_256(bytes: ByteArray): ByteArray
blake2b_224(bytes: ByteArray): ByteArray
verifyEd25519Signature(
  publicKey: ByteArray,
  message: ByteArray,
  signature: ByteArray
): Bool
verifyEcdsaSecp256k1Signature(
  publicKey: ByteArray,
  message: ByteArray,
  signature: ByteArray
): Bool
verifySchnorrSecp256k1Signature(
  publicKey: ByteArray,
  message: ByteArray,
  signature: ByteArray
): Bool
```

### String Builtins

```ts
appendString(a: String, b: String): String
equalsString(a: String, b: String): Bool
encodeUtf8(text: String): ByteArray
decodeUtf8(bytes: ByteArray): String
```

### Control Builtins

These are currently exposed with `Data`-typed branches/results in the compiler's global scope:

```ts
ifThenElse(condition: Bool, whenTrue: Data, whenFalse: Data): Data
chooseUnit(unit: (), value: Data): Data
trace(msg: String, value: Data): Data
```

### Pair And List Builtins

```ts
fstPair[A, B](pair: Pair[A, B]): A
sndPair[A, B](pair: Pair[A, B]): B
chooseList(list: List[Data], whenEmpty: Data, whenNonEmpty: Data): Data
mkCons(head: Data, tail: List[Data]): List[Data]
headList[T](list: List[T]): T
tailList[T](list: List[T]): List[T]
nullList[T](list: List[T]): Bool
```

### Data Builtins

```ts
chooseData(
  data: Data,
  onConstr: Data,
  onMap: Data,
  onList: Data,
  onInt: Data,
  onBytes: Data
): Data
constrData(tag: Int, fields: List[Data]): Data
mapData(entries: List[Pair[Data, Data]]): Data
listData(items: List[Data]): Data
iData(value: Int): Data
bData(value: ByteArray): Data
unConstrData(data: Data): Pair[Int, List[Data]]
unMapData(data: Data): List[Pair[Data, Data]]
unListData(data: Data): List[Data]
unIData(data: Data): Int
unBData(data: Data): ByteArray
equalsData(a: Data, b: Data): Bool
mkPairData(first: Data, second: Data): Pair[Data, Data]
mkNilData(unit: ()): List[Data]
mkNilPairData(unit: ()): List[Pair[Data, Data]]
serialiseData(data: Data): ByteArray
```

### BLS12-381 Builtins

```ts
bls12_381_G1_add(
  a: Bls12_381_G1Element,
  b: Bls12_381_G1Element
): Bls12_381_G1Element
bls12_381_G1_neg(a: Bls12_381_G1Element): Bls12_381_G1Element
bls12_381_G1_scalarMul(
  scalar: Int,
  point: Bls12_381_G1Element
): Bls12_381_G1Element
bls12_381_G1_equal(
  a: Bls12_381_G1Element,
  b: Bls12_381_G1Element
): Bool
bls12_381_G1_hashToGroup(
  msg: ByteArray,
  dst: ByteArray
): Bls12_381_G1Element
bls12_381_G1_compress(point: Bls12_381_G1Element): ByteArray
bls12_381_G1_uncompress(bytes: ByteArray): Bls12_381_G1Element
bls12_381_G2_add(
  a: Bls12_381_G2Element,
  b: Bls12_381_G2Element
): Bls12_381_G2Element
bls12_381_G2_neg(a: Bls12_381_G2Element): Bls12_381_G2Element
bls12_381_G2_scalarMul(
  scalar: Int,
  point: Bls12_381_G2Element
): Bls12_381_G2Element
bls12_381_G2_equal(
  a: Bls12_381_G2Element,
  b: Bls12_381_G2Element
): Bool
bls12_381_G2_hashToGroup(
  msg: ByteArray,
  dst: ByteArray
): Bls12_381_G2Element
bls12_381_G2_compress(point: Bls12_381_G2Element): ByteArray
bls12_381_G2_uncompress(bytes: ByteArray): Bls12_381_G2Element
bls12_381_millerLoop(
  g1: Bls12_381_G1Element,
  g2: Bls12_381_G2Element
): Bls12_381_MlResult
bls12_381_mulMlResult(
  a: Bls12_381_MlResult,
  b: Bls12_381_MlResult
): Bls12_381_MlResult
bls12_381_finalVerify(
  a: Bls12_381_MlResult,
  b: Bls12_381_MlResult
): Bool
```

### Integer And ByteArray Conversion Builtins

```ts
integerToByteString(bigEndian: Bool, size: Int, value: Int): ByteArray
byteStringToInteger(bigEndian: Bool, bytes: ByteArray): Int
```

### Builtin Notes

- `fstPair`, `sndPair`, `headList`, `tailList`, and `nullList` are the main generic value-level builtins injected by the compiler today.
- Types with a `from_data` conversion, such as `Int`, `ByteArray`, `String`, `Bool`, `Real`, `Data`, and compatible `List[...]`/`Pair[..., ...]` shapes, can be used with `as` casts.
- This section documents the actual globals currently created by `makeGlobals()` in [src/index.ts](/home/christian/Src/Helios/compiler-v2/src/index.ts:65).

## Example

```ts
import { compile } from "@helios-lang/compiler-v2"

const entryPoints = compile(
  {
    name: "fib.hl",
    content: `module fib;
fib_tail = (remaining: Int, current: Int, next: Int): Int -> {
  if (equalsInteger(remaining, 0)) {
    current
  } else {
    fib_tail(
      subtractInteger(remaining, 1),
      next,
      addInteger(current, next)
    )
  }
}

export fib = (n: Int): Int -> {
  fib_tail(n, 0, 1)
}`
  },
  {
    compileFunctions: true
  }
)

const fib = entryPoints["fib::fib"]

if (!fib) {
  throw new Error("expected fib::fib entrypoint")
}

console.log(fib.version) // 3
console.log(fib.root) // Uint8Array
```

## Notes

- The package is published as ESM and should be imported with `import`, not `require`.
- The package root currently exports only the compiler entrypoint. If more modules are meant to be public, they should be added to `package.json` exports first.
