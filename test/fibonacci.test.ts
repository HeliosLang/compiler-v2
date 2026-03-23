import { describe, expect, it } from "bun:test"
import { runSync } from "effect/Effect"
import { compile } from "../src/index.js"
import { Uplc } from "@helios-lang/effect/Cardano"

describe("tail-recursive fibonacci", () => {
  function compileFibScriptRoot(): Uplc.Script.Script<3> {
    const entryPoints = compile(
      [
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
    // the first argument is a dummy scriptcontext
    const result = runSync(
      Uplc.Script.eval(script, [{ data: { int: 0n } }, { data: { int: n } }])
    )

    if (result.value._tag == "Left") {
      throw new Error(result.value.left.error)
    }

    return result.value.right
  }

  it("compiles and evaluates fibonacci via tail recursion", () => {
    const root = compileFibScriptRoot()

    const expected: [bigint, bigint][] = [
      [0n, 0n],
      [1n, 1n],
      [2n, 1n],
      [3n, 2n],
      [4n, 3n],
      [5n, 5n],
      [6n, 8n],
      [7n, 13n],
      [8n, 21n],
      [9n, 34n],
      [10n, 55n]
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
