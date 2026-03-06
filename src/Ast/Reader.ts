import * as CompilerError from "./CompilerError.js"
import * as Token from "./Token.js"

/**
 * This module contains a convenience Reader which is used to convert lists of Tokens into Ast nodes
 */

/**
 * The generic type parameter must be used somewhere inside this definition, otherwise typescript fails to infer T inside the Reader.matches method
 * The easiest way to do this is return a truthy value from matches() instead of just a boolean
 *
 * Token matchers are combined with {@link Reader} in order to match sequences of tokens.
 */
export type Matcher<T extends Token.Token = Token.Token> = (
  t: Token.Token
) => T | undefined

const any$: Matcher<Token.Token> = (t) => t

export { any$ as any }

const reserved = ["copy", "else", "if", "switch"]

export const anyName: Matcher<Token.Word> = (t) =>
    t._tag == "Word" &&
    !t.value.startsWith("__") &&
    !reserved.includes(t.value)
        ? t
        : undefined

export const bool =
  (value: boolean | undefined = undefined): Matcher<Token.Bool> =>
  (t) =>
    t._tag == "Bool" && (value !== undefined ? t.value === value : true)
      ? t
      : undefined

export const bytes: Matcher<Token.Bytes> = (t) =>
  t._tag == "Bytes" ? t : undefined

export const comment: Matcher<Token.Comment> = (t) =>
    t._tag == "Comment" ? t : undefined


export const group = <Kind extends Token.GroupOpen = Token.GroupOpen>(open: Kind): Matcher<Token.Group<Kind>> =>(t): Token.Group<Kind> | undefined =>
    t._tag == "Group" && t.open.value == open
    ? (t as Token.Group<Kind>)
    : undefined

export const int =
  (value: bigint | undefined = undefined): Matcher<Token.Int> =>
  (t) =>
    t._tag == "Int" && (value !== undefined ? t.value == value : true)
      ? t
      : undefined

export const oneOf = <Ms extends Matcher[]>(matchers: [...Ms]): Matcher<Ms extends Array<Matcher<infer T>> ? T : never> => (t) => {
    for (const matcher of matchers) {
        const match = matcher(t)

        if (match !== undefined) {
            return match as unknown as (Ms extends Array<Matcher<infer T>> ? T : never)
        }
    }

    return undefined
}

export const real: Matcher<Token.Real> = (t) =>
  t._tag == "Real" ? t : undefined

export const str =
  (value: string | undefined = undefined): Matcher<Token.PlainString> =>
  (t) =>
    t._tag == "PlainString" && (value !== undefined ? t.value == value : true)
      ? t
      : undefined

export const symbol =
  <V extends string = string>(
    v: V | undefined = undefined
  ): Matcher<Token.Symbol<V>> =>
  (t) =>
    t._tag == "Symbol" && (v !== undefined ? t.value == v : true)
      ? (t as Token.Symbol<V>)
      : undefined


export const templateString: Matcher<Token.TemplateString> = (t) =>
    t._tag == "TemplateString"
        ? (t as Token.TemplateString<Token.Token[]>)
        : undefined
      
export const word =
  <V extends string = string>(
    v: V | undefined = undefined,
    options: { caseInsensitive?: boolean } = {}
  ): Matcher<Token.Word<V>> =>
  (t) => {
    if (t._tag != "Word") {
      return undefined
    }

    if (v === undefined) {
      return t as Token.Word<V>
    }

    if (
      options.caseInsensitive === true &&
      v.toLowerCase() == t.value.toLowerCase()
    ) {
      return t as Token.Word<V>
    } else if (v == t.value) {
      return t as Token.Word<V>
    } else {
      return undefined
    }
  }

export type Group<
  Kind extends Token.GroupOpen = Token.GroupOpen,
  Sep extends Token.Separator = Token.Separator
> = Token.Group<Kind, Reader, Sep>

type MapMatchersToTokens<Ms extends Matcher[]> = {
  [M in keyof Ms]: Ms[M] extends Matcher<infer T>
    ? T extends Token.Group<infer K>
      ? Group<K>
      : T
    : never
}

type UnwrapSingleton<T extends any[]> = T extends [infer E] ? E : T

export interface ReaderConfig {
  ignoreNewlines: boolean
}

export class Reader {
  /**
   * Tokens including newlines
   * Can be used for semicolon injection
   */
  readonly origTokens: Token.Token[]

  /**
   * Tokens excluding newlines
   * (Newlines are ignored by the matchers)
   */
  readonly tokens: Token.Token[]

  readonly config: ReaderConfig

  private pos: number

  constructor(tokens: Token.Token[], config: ReaderConfig) {
    this.origTokens = tokens
    this.tokens = tokens
    this.config = config
    this.pos = 0
  }

  /**
   * Excludes newlines
   */
  get rest(): Token.Token[] {
    return this.tokens.slice(this.pos)
  }

  isEof(): boolean {
    return this.pos >= this.tokens.length
  }

  end() {
    if (!this.isEof()) {
      throw new CompilerError.Syntax(
        Token.sourceSpan(this.tokens[this.pos]),
        "unexpected tokens"
      )
    }
  }

  syntaxError(reason: string) {
    return new CompilerError.Syntax(
        Token.sourceSpan(this.tokens[this.pos]),
        reason
    )
  }

  /**
   * Looks for the next token that matches the `matcher`
   * Returns both the token and another TokenReader for preceding tokens
   */
  findNext<Ms extends Matcher[]>(
    ...matchers: [...Ms]
  ): [Reader, ...MapMatchersToTokens<Ms>] | undefined {
    const n = matchers.length

    const i0 = this.pos
    for (let i = i0; i < this.tokens.length; i++) {
      if (this.tokens.length - i >= n) {
        const res = matchers.every(
          (m, j) => m(this.tokens[i + j]) !== undefined
        )

        if (res) {
          const matched = this.tokens
            .slice(i, i + n)
            .map((t) =>
              t._tag == "Group" ? this.augmentGroup(t) : t
            ) as unknown as MapMatchersToTokens<Ms>

          this.pos = i + n

          return [new Reader(this.tokens.slice(i0, i), this.config), ...matched]
        }
      }
    }

    return undefined
  }

  /**
   * Looks for the last token that matches the `matcher`
   * Returns both the token and another TokenReader for preceding tokens
   */
  findLast<Ms extends Matcher[]>(
    ...matchers: [...Ms]
  ): [Reader, ...MapMatchersToTokens<Ms>] | undefined {
    const n = matchers.length

    const i0 = this.pos
    for (let i = this.tokens.length - 1; i >= i0; i--) {
      if (this.tokens.length - i >= n) {
        const res = matchers.every(
          (m, j) => m(this.tokens[i + j]) !== undefined
        )

        if (res) {
          const matched = this.tokens
            .slice(i, i + n)
            .map((t) =>
              t._tag == "Group" ? this.augmentGroup(t) : t
            ) as unknown as MapMatchersToTokens<Ms>

          this.pos = i + n

          return [new Reader(this.tokens.slice(i0, i), this.config), ...matched]
        }
      }
    }

    return undefined
  }

  matches<Ms extends Matcher[]>(
    ...matchers: [...Ms]
  ): UnwrapSingleton<MapMatchersToTokens<Ms>> | undefined {
    const n = matchers.length

    if (this.tokens.length - this.pos >= n) {
      const res = matchers.every(
        (m, j) => m(this.tokens[this.pos + j]) !== undefined
      )

      if (res) {
        const matched = this.tokens
          .slice(this.pos, this.pos + n)
          .map((t) =>
            t._tag == "Group" ? this.augmentGroup(t) : t
          ) as unknown as MapMatchersToTokens<Ms>

        this.pos += n

        if (matched.length == 1) {
          return matched[0] as UnwrapSingleton<MapMatchersToTokens<Ms>>
        } else {
          return matched as UnwrapSingleton<MapMatchersToTokens<Ms>>
        }
      }
    }

    return undefined
  }

  /**
   * Like `find`, looks for the next token that matches the `matcher`
   * Returns a TokenReader for preceding tokens, keeps the matched token in the buffer
   * Reads until the end if not found
   */
  readUntil<Ms extends Matcher[]>(...matchers: [...Ms]): Reader {
    const n = matchers.length

    const m = this.findNext(...matchers)

    if (m !== undefined) {
      const [reader] = m

      this.pos -= n

      return reader
    } else {
      const reader = new Reader(this.tokens, this.config)

      reader.pos = this.pos
      this.pos = this.tokens.length

      return reader
    }
  }

  unreadToken() {
    this.pos = Math.max(this.pos - 1, 0)
  }

  /**
   * Semicolons are inserted right before a newline token if the following conditions hold:
   *   1. the first non-comment token before the NL token isn't a NL or a known multiline operator
   *   2. the first non-comment/non-NL token after the NL token isn't a known multiline operator
   *   3. the NL token isn't the first token in the reader
   *   4. the NL token isn't the last token in the reader
   * @param multilineOperators
   * can be Symbol or Keyword
   * @returns
   */
  insertSemicolons(multilineOperators: string[]): Reader {
    const orig = this.origTokens

    const isMultilineOperator = (t: Token.Token): boolean => {
      if (t._tag == "Symbol" || t._tag == "Word") {
        return multilineOperators.includes(t.value)
      } else {
        return false
      }
    }

    const tokens: Token.Token[] = []

    /**
     * @type {undefined | Token}
     */
    let prev

    const n = orig.length

    for (let i = 0; i < n; i++) {
      const t = orig[i]

      // the NL isn't the first token nor the last token
      if (t._tag == "Newline" && i > 0 && i < n - 1) {
        // the previous token isn't another NL, nor a known multiline operator
        if (prev && prev._tag != "Newline" && !isMultilineOperator(prev)) {
          const next = orig
            .slice(i + 1)
            .find((t) => t._tag != "Comment" && t._tag != "Newline")

          // the next token isn't a known multiline operator
          if (next && !isMultilineOperator(next)) {
            tokens.push({
              _tag: "Symbol",
              value: ";",
              sourceSpan: t.sourceSpan
            })
          }
        }
      }

      tokens.push(t)

      if (t._tag != "Comment") {
        prev = t
      }
    }

    const reader = new Reader(tokens, this.config)

    if (reader.tokens.length > 0) {
      reader.pos = reader.tokens.findIndex((t) => t == this.tokens[this.pos])

      if (reader.pos == -1) {
        throw new Error(
          "TokenReader.insertSemicolons(): unable to keep TokenReader position"
        )
      }
    }

    return reader
  }

  private augmentGroup(t: Token.Group): Group {
    return {
      ...t,
      fields: t.fields.map((f) => new Reader(f, this.config))
    }
  }
}
