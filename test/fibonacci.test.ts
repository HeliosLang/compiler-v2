import { describe, expect, it } from "bun:test"
import { runSync } from "effect/Effect"
import { compile } from "../src/index.js"
import { Uplc } from "@helios-lang/effect/Cardano"

describe("indexByteString", () => {
  function compileFibScriptRoot(): Uplc.Script.Script<3> {
    const entryPoints = compile(
      [
        {
          name: "fib.hl",
          content: `module fib;
  export fib = (n: Int): Int -> {
    indexByteString(#000101020305080d, n)
  }`
        }
      ],
      {
        compileFunctions: true
      }
    )

    const fib = entryPoints["fib::fib"]

    if (fib === undefined) {
      throw new Error("expected fib::fib entrypoint")
    }

    return fib
  }

  function evalFib(script: Uplc.Script.Script<3>, n: bigint): Uplc.Cek.Value {
    const result = runSync(Uplc.Script.eval(script, [n]))
      
    if (result.value._tag == "Left") {
      throw new Error(result.value.left.error)
    }

    return result.value.right
  }

  it("compiles and evaluates hardcoded fibonacci numbers via Uplc.Cek.eval", () => {
    const root = compileFibScriptRoot()

    const expected: [bigint, bigint][] = [
      [0n, 0n],
      [1n, 1n],
      [2n, 1n],
      [3n, 2n],
      [4n, 3n],
      [5n, 5n],
      [6n, 8n],
      [7n, 13n]
    ]

    for (const [input, output] of expected) {
      const value = evalFib(root, input)

      expect(value).toEqual({
        _tag: "Const",
        value: output
      })
    }
  })
})
