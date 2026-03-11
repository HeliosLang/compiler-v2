import { describe, expect, it } from "bun:test"
import { tokenize, type TokenizeOptions } from "./Token.js"

const source = (content: string) => ({
  name: "Token.test",
  content
})

const tokenizeWithErrors = (content: string, options: TokenizeOptions = {}) => {
  const tokens = tokenize(source(content), {
    ...options,
    nestGroups: false,
    attachComments: false
  })

  return { tokens }
}

describe("tokenize", () => {
  it("tokenizes a Bool token", () => {
    const result = tokenizeWithErrors("true")

    expect(result.tokens).toEqual([
      {
        _tag: "Bool",
        value: true,
        sourceSpan: { source: source("true"), start: 0, end: 4 }
      }
    ])
  })

  it("tokenizes a Bytes token", () => {
    const result = tokenizeWithErrors("#deAdBEEF")

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Bytes")

    const token = result.tokens[0]
    if (token?._tag != "Bytes") {
      throw new Error("expected Bytes token")
    }

    expect(token.encoding).toBe("Hex")
    expect(Array.from(token.value)).toEqual([0xde, 0xad, 0xbe, 0xef])
  })

  it("tokenizes a Comment token", () => {
    const result = tokenizeWithErrors("// hello", {
      preserveComments: true,
      preserveNewlines: false
    })

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Comment")

    const token = result.tokens[0]
    if (token?._tag != "Comment") {
      throw new Error("expected Comment token")
    }

    expect(token.value).toBe("// hello\0")
  })

  it("tokenizes an Int token", () => {
    const result = tokenizeWithErrors("1234")

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Int")

    const token = result.tokens[0]
    if (token?._tag != "Int") {
      throw new Error("expected Int token")
    }

    expect(token.encoding).toBe("Decimal")
    expect(token.value).toBe(1234n)
  })

  it("tokenizes a Newline token", () => {
    const result = tokenizeWithErrors("\n", { preserveNewlines: true })

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Newline")
  })

  it("tokenizes a PlainString token", () => {
    const result = tokenizeWithErrors('"hello"')

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("PlainString")

    const token = result.tokens[0]
    if (token?._tag != "PlainString") {
      throw new Error("expected PlainString token")
    }

    expect(token.value).toBe("hello")
  })

  it("tokenizes a TemplateString token", () => {
    const result = tokenizeWithErrors('"hello ${name}"')

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("TemplateString")

    const token = result.tokens[0]
    if (token?._tag != "TemplateString") {
      throw new Error("expected TemplateString token")
    }

    expect(token.strings).toEqual(["hello ", ""])
    expect(token.tokens).toEqual([
      [
        {
          _tag: "Word",
          value: "name",
          sourceSpan: { source: source('"hello ${name}"'), start: 9, end: 13 }
        }
      ]
    ])
  })

  it("does not tokenize escaped \\$ as template interpolation", () => {
    const result = tokenizeWithErrors('"price: \\${name}"')

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("PlainString")

    const token = result.tokens[0]
    if (token?._tag != "PlainString") {
      throw new Error("expected PlainString token")
    }

    expect(token.value).toBe("price: ${name}")
  })

  it("tokenizes a Real token", () => {
    const result = tokenizeWithErrors("1.25")

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Real")

    const token = result.tokens[0]
    if (token?._tag != "Real") {
      throw new Error("expected Real token")
    }

    expect(token.value).toBe(1250000n)
  })

  it("tokenizes a Symbol token", () => {
    const result = tokenizeWithErrors("=>")

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Symbol")

    const token = result.tokens[0]
    if (token?._tag != "Symbol") {
      throw new Error("expected Symbol token")
    }

    expect(token.value).toBe("=>")
  })

  it("tokenizes a Word token", () => {
    const result = tokenizeWithErrors("hello_1")

    expect(result.tokens.length).toBe(1)
    expect(result.tokens[0]?._tag).toBe("Word")

    const token = result.tokens[0]
    if (token?._tag != "Word") {
      throw new Error("expected Word token")
    }

    expect(token.value).toBe("hello_1")
  })
})

const nest = (content: string, options: TokenizeOptions = {}) => {
  const tokens = tokenize(source(content), {
    ...options,
    nestGroups: true,
    attachComments: true
  })

  return { tokens }
}

describe("nestGroups", () => {
  it("nests matching group symbols", () => {
    const result = nest("(alpha)")

    expect(result.tokens).toEqual([
      {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan: { source: source("(alpha)"), start: 0, end: 1 }
        },
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan: { source: source("(alpha)"), start: 6, end: 7 }
        },
        separators: [],
        fields: [
          [
            {
              _tag: "Word",
              value: "alpha",
              sourceSpan: { source: source("(alpha)"), start: 1, end: 6 }
            }
          ]
        ]
      }
    ])
  })

  it("nests groups recursively", () => {
    const result = nest("(a, [b, {c}])")

    expect(result.tokens.length).toBe(1)

    const top = result.tokens[0]
    if (top?._tag != "Group") {
      throw new Error("expected Group")
    }

    expect(top.open.value).toBe("(")
    expect(top.fields.length).toBe(2)

    const second = top.fields[1]?.[0]
    if (second?._tag != "Group") {
      throw new Error("expected nested Group")
    }

    expect(second.open.value).toBe("[")

    const thirdLevel = second.fields[1]?.[0]
    if (thirdLevel?._tag != "Group") {
      throw new Error("expected third-level Group")
    }

    expect(thirdLevel.open.value).toBe("{")
  })

  it("reports unmatched close symbols and recovers into a group", () => {
    expect(() => nest("]")).toThrow(/unmatched/)
  })

  it("reports mismatched open and close symbols", () => {
    expect(() => nest("(]")).toThrow(/unmatched '\('/)
  })
})
