import { describe, expect, it } from "bun:test"
import { runSync } from "effect/Effect"
import { compile } from "../src/index.js"
import { Uplc } from "@helios-lang/effect/Cardano"

function evalEntryPoint(
  sourceName: string,
  sourceContent: string
): Uplc.Cek.Value {
  const entryPoints = compile(
    [
      {
        name: sourceName,
        content: sourceContent
      }
    ],
    {
      compileFunctions: true
    }
  )

  const entryPointName = `${sourceName.replace(/\.hl$/, "")}::main`
  const main = entryPoints[entryPointName]

  if (main === undefined) {
    throw new Error(`expected ${entryPointName} entrypoint`)
  }

  // the first argument is a dummy script context
  const result = runSync(Uplc.Script.eval(main, [{ data: { int: 0n } }]))

  if (result.value._tag == "Left") {
    throw new Error(result.value.left.error)
  }

  return result.value.right
}

function compileEntryPoint(
  sourceName: string,
  sourceContent: string
): Uplc.Script.Script<3> {
  const entryPoints = compile(
    [
      {
        name: sourceName,
        content: sourceContent
      }
    ],
    {
      compileFunctions: true
    }
  )

  const entryPointName = `${sourceName.replace(/\.hl$/, "")}::main`
  const main = entryPoints[entryPointName]

  if (main === undefined) {
    throw new Error(`expected ${entryPointName} entrypoint`)
  }

  return main
}

describe("builtin globals", () => {
  it("resolves arithmetic and Data-limited generic builtins through compile()", () => {
    const value = evalEntryPoint(
      "builtins.hl",
      `module builtins;
export main = (): Int -> {
  unIData(ifThenElse(true, iData(1 + 2), iData(0)))
}`
    )

    expect(value).toEqual({
      _tag: "Const",
      value: 3n
    })
  })

  it("resolves integer-byte conversion builtins through compile()", () => {
    const script = compileEntryPoint(
      "conversions.hl",
      `module conversions;
export main = (): Int -> {
  byteStringToInteger(false, integerToByteString(false, 1, 255))
}`
    )

    expect(script.version).toBe(3)
  })
})
