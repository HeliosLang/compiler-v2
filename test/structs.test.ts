import { describe, expect, it } from "bun:test"
import { runSync } from "effect/Effect"
import { compile } from "../src/index.js"
import { Uplc } from "@helios-lang/effect/Cardano"

function evalMain(
  sourceName: string,
  sourceContent: string,
  args: Uplc.Value.Value[]
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

  const result = runSync(Uplc.Script.eval(main, args))

  if (result.value._tag == "Left") {
    throw new Error(result.value.left.error)
  }

  return result.value.right
}

describe("struct entrypoints", () => {
  it("casts struct-typed entrypoint args from Data before evaluating main", () => {
    const value = evalMain(
      "structFromData.hl",
      `module structFromData;
export MyPair = struct { a: Int, b: Int };
export main = (pair: MyPair): Int -> addInteger(pair.a, pair.b)`,
      [{ data: { int: 0n } }, { data: { list: [{ int: 2n }, { int: 3n }] } }]
    )

    expect(value).toEqual({
      _tag: "Const",
      value: 5n
    })
  })

  it("accesses non-head struct properties correctly after decoding", () => {
    const value = evalMain(
      "structProperties.hl",
      `module structProperties;
export Triple = struct { first: Int, second: Int, third: Int };
export main = (triple: Triple): Int -> triple.third`,
      [
        { data: { int: 0n } },
        {
          data: {
            list: [{ int: 11n }, { int: 22n }, { int: 33n }]
          }
        }
      ]
    )

    expect(value).toEqual({
      _tag: "Const",
      value: 33n
    })
  })

  it("decodes tagged structs from constructor data", () => {
    const value = evalMain(
      "taggedStruct.hl",
      `module taggedStruct;
export MyPair = struct 0 { a: Int, b: Int };
export main = (pair: MyPair): Int -> addInteger(pair.a, pair.b)`,
      [
        { data: { int: 0n } },
        {
          data: {
            constructor: 0,
            fields: [{ int: 2n }, { int: 3n }]
          }
        }
      ]
    )

    expect(value).toEqual({
      _tag: "Const",
      value: 5n
    })
  })
})
