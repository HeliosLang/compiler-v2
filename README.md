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
