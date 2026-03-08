import * as Source from "../Source/index.js"
import * as CompilerError from "./CompilerError.js"

interface WithSpan {
  readonly sourceSpan: Source.Span
}

interface WithComments extends WithSpan {
  readonly comments?: Comment[]
}

export interface Bool extends WithComments {
  readonly _tag: "Bool"
  readonly value: boolean
}

export interface Bytes extends WithComments {
  readonly _tag: "Bytes"
  readonly encoding: "Hex" | "Utf8"
  readonly value: Uint8Array
}

export interface Comment extends WithSpan {
  readonly _tag: "Comment"

  /**
   * Includes the delimiters and internal newlines
   */
  readonly value: string
}

const BRACKETS = {
  "(": ")" as const,
  "[": "]" as const,
  "{": "}" as const
}

export type GroupOpen = keyof typeof BRACKETS

export type GroupClose<Kind extends GroupOpen = GroupOpen> = Kind extends "("
  ? ")"
  : Kind extends "{"
    ? "}"
    : Kind extends "["
      ? "]"
      : ")" | "}" | "]"

function isGroupOpenSymbol(t: Token): t is Symbol$<GroupOpen> {
  return t._tag == "Symbol" && Object.keys(BRACKETS).includes(t.value)
}

function isGroupCloseSymbol(t: Token): t is Symbol$<GroupClose> {
  return (
    t._tag == "Symbol" &&
    (Object.values(BRACKETS) as string[]).includes(t.value)
  )
}

function mapGroupOpenToClose<V extends GroupOpen = GroupOpen>(
  v: V
): GroupClose<V> {
  return BRACKETS[v] as unknown as GroupClose<V>
}

function mapGroupCloseToOpen<V extends GroupOpen = GroupOpen>(
  v: GroupClose<V>
): V {
  const oc = Object.entries(BRACKETS).find(([, c]) => c == v)

  if (!oc) {
    throw new Error("unable to map close to open symbol")
  }

  return oc[0] as unknown as V
}

export type Separator = ","

export interface Group<
  Kind extends GroupOpen = GroupOpen,
  Field = Token[],
  Sep extends Separator = Separator
> {
  readonly _tag: "Group"
  readonly open: Symbol$<Kind>
  readonly fields: Field[]
  readonly separators: Symbol$<Sep>[]
  readonly close: Symbol$<GroupClose<Kind>>
}

export interface Int extends WithComments {
  readonly _tag: "Int"
  readonly encoding: "Binary" | "Decimal" | "Hex" | "Octal"
  readonly value: bigint
}

/**
 * `Newline` is a {@link Token} variant that represents a newline character.
 *
 * Newline characters are used for Automatic Semicolon Insertion.
 */
export interface Newline extends WithSpan {
  readonly _tag: "Newline"
}

export interface PlainString extends WithComments {
  readonly _tag: "PlainString"
  readonly value: string
}

export interface Real extends WithComments {
  readonly _tag: "Real"
  readonly value: bigint
}

interface Symbol$<T extends string = string> extends WithComments {
  readonly _tag: "Symbol"
  readonly value: T
}

export type { Symbol$ as Symbol }

function isSeparator(t: Token): t is Symbol$<Separator> {
  return t._tag == "Symbol" && t.value == ","
}

function isSymbol<V extends string = string>(t: Token, v: V): t is Symbol$<V> {
  return t._tag == "Symbol" && t.value == v
}

export interface TemplateString<T = Token[]> extends WithComments {
  readonly _tag: "TemplateString"
  readonly strings: string[]
  readonly tokens: T[]
}

export interface Word<V extends string = string> extends WithComments {
  readonly _tag: "Word"
  readonly value: V
}

/**
 * Tokens are the leafs of the AST
 */
export type Token =
  | Bool
  | Bytes
  | Comment
  | Group
  | Int
  | Newline
  | PlainString
  | TemplateString
  | Real
  | Symbol$
  | Word

export interface TokenizeOptions {
  sourceMap?: Source.Map | undefined
  extraValidFirstLetters?: string
  realPrecision?: number
  tokenizeReal?: boolean
  attachComments?: boolean
  preserveComments?: boolean
  preserveNewlines?: boolean
  allowLeadingZeroes?: boolean
  nestGroups?: boolean
}

interface TokenizerConfig {
  sourceMap: Source.Map | undefined
  validFirstLetters: Set<string>
  realPrecision: number
  tokenizeReal: boolean
  preserveComments: boolean
  preserveNewlines: boolean
  allowLeadingZeroes: boolean
}

export const tokenize = (
  source: Source.Source,
  {
    sourceMap = undefined,
    realPrecision = 6,
    tokenizeReal = true,
    extraValidFirstLetters = "",
    preserveComments = true,
    preserveNewlines = true,
    allowLeadingZeroes = false,
    nestGroups: ng = true,
    attachComments: ac = true
  }: TokenizeOptions = {}
) => {
  const validFirstLetters = new Set(
    (DEFAULT_VALID_FIRST_LETTERS + extraValidFirstLetters).split("")
  )

  const tokenizer = new Tokenizer(source, {
    sourceMap,
    realPrecision,
    tokenizeReal,
    preserveComments,
    preserveNewlines,
    allowLeadingZeroes,
    validFirstLetters
  })

  tokenizer.tokenize()

  let tokens = tokenizer.tokens

  if (ac) {
    tokens = attachComments(tokens)
  }

  if (ng) {
    tokens = nestGroups(tokens)
  }

  return tokens
}

const attachComments = (tokens: Token[]): Token[] => {
  // attach comments preceeding any other token
  const result: Exclude<Token, Comment>[] = [] // might still contain tokens at end
  let unattachedComments: Comment[] = []

  for (const token of tokens) {
    switch (token._tag) {
      case "Bool":
      case "Bytes":
      case "Int":
      case "PlainString":
      case "Real":
      case "Symbol":
      case "Word":
        if (unattachedComments.length > 0) {
          result.push({
            ...token,
            comments: unattachedComments
          })

          unattachedComments = []
        } else {
          result.push(token)
        }
        break
      case "TemplateString":
        if (unattachedComments.length > 0) {
          result.push({
            ...token,
            tokens: token.tokens.map(attachComments),
            comments: unattachedComments
          })

          unattachedComments = []
        } else {
          result.push({
            ...token,
            tokens: token.tokens.map(attachComments)
          })
        }
        break
      case "Newline":
        result.push(token)
        break
      case "Group":
        throw new Error(
          "attachComments() must be called before groups are nested"
        )
      case "Comment":
        unattachedComments.push(token)
        break
      default:
        throw new Error(`unhandled token type '${(token as Token)._tag}'`)
    }
  }

  return (result as Token[]).concat(unattachedComments)
}

const nestGroups = (ts: Token[]): Token[] => {
  const stack: Token[][] = []
  let current: Token[] = []

  for (const t of ts) {
    switch (t._tag) {
      case "Symbol":
        if (isGroupOpenSymbol(t)) {
          // every open symbol increases the stack depth
          stack.push(current)

          current = [t]
        } else if (isGroupCloseSymbol(t)) {
          // every close symbol decreases the stack depth
          const expectedOpenValue = mapGroupCloseToOpen(t.value)
          const open = current[0]

          if (!(open?._tag == "Symbol" && isGroupOpenSymbol(open))) {
            throw new CompilerError.Syntax(
              t.sourceSpan,
              `unmatched '${t.value}'`
            )
          } else if (open.value != expectedOpenValue) {
            throw new CompilerError.Syntax(
              t.sourceSpan,
              `unmatched '${open.value}' (got '${t.value}' as close symbol, but expected '${mapGroupOpenToClose(open.value)}')`
            )
          }

          const group = makeGroup(current.concat([t]))

          current = stack.pop() ?? []

          current.push(group)
        } else {
          current.push(t)
        }
        break
      case "Bool":
      case "Bytes":
      case "Comment":
      case "Int":
      case "Newline":
      case "PlainString":
      case "Real":
      case "Word":
        current.push(t)
        break
      case "Group":
        current.push({
          ...t,
          fields: t.fields.map(nestGroups)
        })
        break
      case "TemplateString":
        current.push({
          ...t,
          tokens: t.tokens.map(nestGroups)
        })
        break
      default:
        throw new Error(
          `unhandled '${(t as Token)._tag}' Token in nestGroups()`
        )
    }
  }

  if (stack.length > 0) {
    const t = stack[stack.length - 1][0]

    if (t?._tag != "Symbol") {
      if (current.length > 0) {
        const open = current[0]

        if (open._tag == "Symbol") {
          throw new CompilerError.Syntax(
            open.sourceSpan,
            `unmatched '${open.value}'`
          )
        } else {
          throw new Error("unhandled")
        }
      }
    } else {
      throw new CompilerError.Syntax(t.sourceSpan, `unmatched '${t.value}'`)
    }
  }

  return current
}

function isEmptyField(ts: Token[]): boolean {
  return ts.every((t) => t._tag == "Newline" || t._tag == "Comment")
}

export function sourceSpan(t: Token): Source.Span {
  return t._tag == "Group" ? t.open.sourceSpan : t.sourceSpan
}

/**
 * Separates tokens in fields (separted by commas)
 * @param ts
 * The first and last token in this list are expected to be the open and close symbols
 */
const makeGroup = (ts: Token[]): Group => {
  const open = ts.shift()
  if (!open || !(open._tag == "Symbol" && isGroupOpenSymbol(open))) {
    throw new Error("unexpected")
  }

  const stack: Symbol$<GroupOpen>[] = [open]

  let curField: Token[] = []
  const fields: Token[][] = []
  const separators: Symbol$<Separator>[] = []
  let close: Symbol$<GroupClose> | undefined = undefined

  let t = ts.shift()
  let prev = stack.pop()

  while (prev && t) {
    if (isSymbol(t, mapGroupOpenToClose(prev.value))) {
      // the close symbol is matched and the stack depth is decreased
      if (stack.length > 0) {
        curField.push(t)
      } else {
        // we've found the final close symbol
        close = t
      }
    } else {
      // re-add to the stack to so it decrease in depth
      stack.push(prev)

      if (isGroupCloseSymbol(t)) {
        throw new CompilerError.Syntax(t.sourceSpan, `unmatched '${t.value}'`)
      } else if (isGroupOpenSymbol(t)) {
        stack.push(t)
        curField.push(t)
      } else if (isSeparator(t) && stack.length == 1) {
        separators.push(t)

        if (curField.length == 0) {
          throw new CompilerError.Syntax(t.sourceSpan, "empty field")
        } else {
          fields.push(curField)
          curField = []
        }
      } else {
        curField.push(t)
      }
    }

    prev = stack.pop()
    t = ts.shift()
  }

  const last = stack.pop()
  if (last != undefined) {
    throw new CompilerError.Syntax(
      last.sourceSpan,
      `EOF while matching '${last.value}'`
    )
  }

  if (!close) {
    throw new Error("unexpected missing close symbol")
  }

  if (curField.length > 0) {
    // add remaining field
    fields.push(curField)
  }

  if (separators.length > 0 && separators.length >= fields.length) {
    throw new CompilerError.Syntax(
      separators[separators.length - 1].sourceSpan,
      `trailing comma`
    )
  }

  if (fields.length >= 2) {
    fields.forEach((f, i) => {
      if (isEmptyField(f)) {
        throw new CompilerError.Syntax(
          open.sourceSpan,
          `group field ${i + 1} is empty`
        )
      }
    })
  }

  const expectedSeparators = Math.max(fields.length - 1, 0)

  if (separators.length > expectedSeparators) {
    throw new CompilerError.Syntax(
      open.sourceSpan,
      `'${open.value}' group: excess '${separators[0].value}' - expected ${expectedSeparators}, got ${separators.length}`
    )
  } else if (separators.length != expectedSeparators) {
    throw new Error(`expected ${expectedSeparators}, got ${separators.length}`)
  }

  return {
    _tag: "Group",
    separators,
    fields,
    open,
    close
  }
}

/**
 * Valid starting symbols for words
 */
export const DEFAULT_VALID_FIRST_LETTERS =
  "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

class Tokenizer {
  readonly config: TokenizerConfig

  private readonly charReader: CharReader

  /**
   * Tokens are accumulated in this list
   */
  tokens: Token[]

  constructor(source: Source.Source, config: TokenizerConfig) {
    this.config = config

    this.charReader = new CharReader(source, config.sourceMap)

    this.tokens = []
  }

  /**
   * Tokenize the complete source. Doesn't perform any grouping
   */
  tokenize() {
    this.tokens = []

    let s = this.nextCharSpan
    let c = this.readChar()

    while (c != "\0") {
      this.readToken(s, c)

      s = this.nextCharSpan
      c = this.readChar()
    }
  }

  /**
   * Returns a generator
   * Use gen.next().value to access to the next Token
   * Doesn't perform any grouping
   * Used for quickly parsing the header of a script
   */
  *stream(): Generator<Token> {
    this.tokens = []

    let s = this.nextCharSpan
    let c = this.readChar()

    while (c != "\0") {
      this.readToken(s, c)

      let t = this.tokens.shift()
      while (t != undefined) {
        yield t
        t = this.tokens.shift()
      }

      s = this.nextCharSpan
      c = this.readChar()
    }
  }

  private get nextCharSpan(): Source.Span {
    return this.charReader.span
  }

  private mergeSpan(start: Source.Span): Source.Span {
    const end = this.nextCharSpan

    if (Source.isDummySpan(end)) {
      return start
    } else {
      return {
        source: start.source,
        start: start.start,
        end: end.start
      }
    }
  }

  private pushToken(t: Token) {
    this.tokens.push(t)
  }

  /**
   * Reads a single char from the source and advances _pos by one
   */
  private readChar(): string {
    return this.charReader.read()
  }

  private peekChar(): string {
    return this.charReader.peek()
  }

  /**
   * Decreases source index pos by one
   */
  private unreadChar(): void {
    this.charReader.unread()
  }

  /**
   * Start reading precisely one token
   */
  private readToken(s: Source.Span, c: string) {
    if (c == "b") {
      this.readMaybeUtf8ByteArray(s)
    } else if (this.config.validFirstLetters.has(c)) {
      this.readWord(s, c)
    } else if (c == "/") {
      this.readMaybeComment(s)
    } else if (c == "0") {
      this.readSpecialInteger(s)
    } else if (c >= "1" && c <= "9") {
      this.readDecimalInt(s, c)
    } else if (c == "#") {
      this.readHexBytes(s)
    } else if (c == '"') {
      this.readString(s)
    } else if (
      c == "?" ||
      c == "!" ||
      c == "%" ||
      c == "&" ||
      (c >= "(" && c <= ".") ||
      (c >= ":" && c <= ">") ||
      c == "[" ||
      c == "]" ||
      (c >= "{" && c <= "}")
    ) {
      this.readSymbol(s, c)
    } else if (this.config.preserveNewlines && c == "\n") {
      this.pushToken({ _tag: "Newline", sourceSpan: s })
    } else if (!(c == " " || c == "\n" || c == "\t" || c == "\r")) {
      throw new CompilerError.Syntax(
        s,
        `invalid source character '${c}' (utf-8 not yet supported outside string literals)`
      )
    }
  }

  /**
   * Reads one word token.
   * Immediately turns "true" or "false" into a BoolLiteral instead of keeping it as Word
   */
  private readWord(start: Source.Span, c0: string) {
    const chars = []

    let c = c0
    while (c != "\0") {
      if ((c >= "0" && c <= "9") || this.config.validFirstLetters.has(c)) {
        chars.push(c)
        c = this.readChar()
      } else {
        this.unreadChar()
        break
      }
    }

    const value = chars.join("")
    const sourceSpan = this.mergeSpan(start)

    if (value == "true" || value == "false") {
      this.pushToken({
        _tag: "Bool",
        value: value == "true",
        sourceSpan
      })
    } else {
      this.pushToken({ _tag: "Word", value, sourceSpan })
    }
  }

  /**
   * Reads and optionally discards a comment if current '/' char is followed by '/' or '*'.
   * Otherwise pushes Symbol('/') onto _tokens
   */
  private readMaybeComment(s: Source.Span) {
    const c = this.readChar()

    if (c == "\0") {
      this.pushToken({
        _tag: "Symbol",
        value: "/",
        sourceSpan: s
      })
    } else if (c == "/") {
      this.readSingleLineComment(s)
    } else if (c == "*") {
      this.readMultiLineComment(s)
    } else {
      this.pushToken({
        _tag: "Symbol",
        value: "/",
        sourceSpan: s
      })

      this.unreadChar()
    }
  }

  /**
   * Reads and discards a single line comment (from '//' to end-of-line)
   */
  private readSingleLineComment(start: Source.Span) {
    let s = this.nextCharSpan
    let c = this.readChar()
    const chars = ["/", "/", c]

    while (c != "\n" && c != "\0") {
      s = this.nextCharSpan
      c = this.readChar()
      chars.push(c)
    }

    if (this.config.preserveComments) {
      this.pushToken({
        _tag: "Comment",
        value: chars.join(""),
        sourceSpan: this.mergeSpan(start)
      })
    }

    if (this.config.preserveNewlines) {
      this.pushToken({ _tag: "Newline", sourceSpan: s })
    }
  }

  /**
   * Reads and discards a multi-line comment (from '/' '*' to '*' '/')
   */
  private readMultiLineComment(start: Source.Span) {
    let prev: string
    let c = this.readChar()
    const chars = ["/", "*", c]

    while (true) {
      prev = c
      c = this.readChar()
      chars.push(c)

      if (c == "/" && prev == "*") {
        break
      } else if (c == "\0") {
        throw new CompilerError.Syntax(
          this.mergeSpan(start),
          "unterminated multiline comment"
        )
      }
    }

    if (this.config.preserveComments) {
      this.pushToken({
        _tag: "Comment",
        value: chars.join(""),
        sourceSpan: this.mergeSpan(start)
      })
    }
  }

  /**
   * Reads a literal integer
   */
  private readSpecialInteger(start: Source.Span) {
    const c = this.readChar()

    if (c == "\0") {
      this.pushToken({
        _tag: "Int",
        encoding: "Decimal",
        value: 0n,
        sourceSpan: start
      })
    } else if (c == "b") {
      this.readBinaryInteger(start)
    } else if (c == "o") {
      this.readOctalInteger(start)
    } else if (c == "x") {
      this.readHexInteger(start)
    } else if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      throw new CompilerError.Syntax(start, `bad literal integer type 0${c}`)
    } else if (c >= "0" && c <= "9") {
      if (this.config.allowLeadingZeroes) {
        this.readDecimalInt(start, c)
      } else {
        throw new CompilerError.Syntax(start, "unexpected leading 0")
      }
    } else if (c == "." && this.config.tokenizeReal) {
      this.readFixedPoint(start, ["0"])
    } else {
      this.pushToken({
        _tag: "Int",
        encoding: "Decimal",
        value: 0n,
        sourceSpan: start
      })
      this.unreadChar()
    }
  }

  private readBinaryInteger(start: Source.Span) {
    this.readRadixInteger(start, "0b", "Binary", (c) => c == "0" || c == "1")
  }

  private readOctalInteger(start: Source.Span) {
    this.readRadixInteger(start, "0o", "Octal", (c) => c >= "0" && c <= "7")
  }

  private readHexInteger(start: Source.Span) {
    this.readRadixInteger(
      start,
      "0x",
      "Hex",
      (c) => (c >= "0" && c <= "9") || (c >= "a" && c <= "f")
    )
  }

  private assertCorrectDecimalUnderscores(
    span: Source.Span,
    chars: string[],
    reverse: boolean = false
  ): string[] {
    if (chars.some((c) => c == "_")) {
      for (let i = 0; i < chars.length; i++) {
        const c = reverse ? chars[chars.length - 1 - i] : chars[i]

        if (i == chars.length - 1) {
          if (c == "_") {
            throw new CompilerError.Syntax(span, "redundant decimal underscore")
          }
        }

        if ((i + 1) % 4 == 0) {
          if (c != "_") {
            throw new CompilerError.Syntax(span, "bad decimal underscore")
          }
        } else {
          if (c == "_") {
            throw new CompilerError.Syntax(span, "bad decimal underscore")
          }
        }
      }

      return chars.filter((c) => c != "_")
    } else {
      return chars
    }
  }

  private readDecimalInt(start: Source.Span, c0: string) {
    let chars: string[] = []

    let c = c0
    while (c != "\0") {
      if ((c >= "0" && c <= "9") || c == "_") {
        chars.push(c)
      } else {
        if (
          (c >= "0" && c <= "9") ||
          (c >= "A" && c <= "Z") ||
          (c >= "a" && c <= "z")
        ) {
          throw new CompilerError.Syntax(
            this.mergeSpan(start),
            "invalid syntax for decimal integer literal"
          )
        } else if (c == "." && this.config.tokenizeReal) {
          const cf = this.peekChar()

          if (cf >= "0" && cf <= "9") {
            this.readFixedPoint(start, chars)

            return
          }
        }

        this.unreadChar()
        break
      }

      c = this.readChar()
    }

    const sourceSpan = this.mergeSpan(start)
    chars = this.assertCorrectDecimalUnderscores(sourceSpan, chars, true)

    this.pushToken({
      _tag: "Int",
      encoding: "Decimal",
      value: BigInt(chars.filter((c) => c != "_").join("")),
      sourceSpan: sourceSpan
    })
  }

  /**
   * @param start
   * @param prefix
   * @param valid
   * Checks if character is valid as part of the radix
   */
  private readRadixInteger(
    start: Source.Span,
    prefix: string,
    encoding: Int["encoding"],
    valid: (c: string) => boolean
  ) {
    let c = this.readChar()

    const chars = []

    if (!valid(c)) {
      throw new CompilerError.Syntax(
        this.mergeSpan(start),
        `expected at least one char for ${prefix} integer literal`
      )
      this.unreadChar()
      return
    }

    while (c != "\0") {
      if (valid(c)) {
        chars.push(c)
      } else {
        if (
          (c >= "0" && c <= "9") ||
          (c >= "A" && c <= "Z") ||
          (c >= "a" && c <= "z")
        ) {
          throw new CompilerError.Syntax(
            this.mergeSpan(start),
            `invalid syntax for ${prefix} integer literal`
          )
        }

        this.unreadChar()
        break
      }

      c = this.readChar()
    }

    this.pushToken({
      _tag: "Int",
      encoding,
      value: BigInt(prefix + chars.join("")),
      sourceSpan: this.mergeSpan(start)
    })
  }

  private readFixedPoint(start: Source.Span, leading: string[]) {
    let trailing: string[] = []

    let c = this.readChar()

    while (c != "\0") {
      if ((c >= "0" && c <= "9") || c == "_") {
        trailing.push(c)
      } else {
        this.unreadChar()
        break
      }

      c = this.readChar()
    }

    const tokenSite = this.mergeSpan(start)

    leading = this.assertCorrectDecimalUnderscores(tokenSite, leading, true)

    trailing = this.assertCorrectDecimalUnderscores(tokenSite, trailing, false)

    if (trailing.length > this.config.realPrecision) {
      throw new CompilerError.Syntax(
        tokenSite,
        `literal real decimal places overflow (max ${this.config.realPrecision} supported, but ${trailing.length} specified)`
      )
      trailing.splice(this.config.realPrecision)
    }

    while (trailing.length < this.config.realPrecision) {
      trailing.push("0")
    }

    this.pushToken({
      _tag: "Real",
      value: BigInt(leading.concat(trailing).join("")),
      sourceSpan: tokenSite
    })
  }

  /**
   * Reads literal hexadecimal representation of ByteArray
   */
  private readHexBytes(start: Source.Span) {
    let c = this.readChar()

    const chars = []

    // case doesn't matter
    while (
      (c >= "a" && c <= "f") ||
      (c >= "A" && c <= "F") ||
      (c >= "0" && c <= "9")
    ) {
      chars.push(c)
      c = this.readChar()
    }

    // empty byteArray is allowed (eg. for Ada mintingPolicyHash)

    // last char is the one that made the while loop break, so should be unread
    this.unreadChar()

    const bytes = Uint8Array.fromHex(chars.join(""))

    this.pushToken({
      _tag: "Bytes",
      encoding: "Hex",
      value: bytes,
      sourceSpan: this.mergeSpan(start)
    })
  }

  /**
   * Reads literal Utf8 string and immediately encodes it as a ByteArray
   */
  private readMaybeUtf8ByteArray(s: Source.Span) {
    const c = this.readChar()

    if (c == '"') {
      const str = this.readStringInternal(s)

      this.pushToken({
        _tag: "Bytes",
        encoding: "Utf8",
        value: new TextEncoder().encode(str),
        sourceSpan: this.mergeSpan(s)
      })
    } else {
      this.unreadChar()

      this.readWord(s, "b")
    }
  }

  /**
   * Doesn't push a token, instead returning the string itself
   */
  private readStringInternal(start: Source.Span): string {
    let c = this.readChar()

    const chars = []

    let escaping = false

    /**
     * This span is used for escape syntax errors
     */
    let escapeSpan: Source.Span | undefined = undefined

    while (!(!escaping && c == '"')) {
      if (c == "\0") {
        throw new CompilerError.Syntax(start, "unmatched '\"'")
        break
      }

      if (escaping) {
        if (c == "n") {
          chars.push("\n")
        } else if (c == "t") {
          chars.push("\t")
        } else if (c == "\\") {
          chars.push("\\")
        } else if (c == '"') {
          chars.push(c)
        } else if (escapeSpan !== undefined) {
          throw new CompilerError.Syntax(
            this.mergeSpan(escapeSpan),
            `invalid escape sequence ${c}`
          )
        } else {
          throw new Error("escape site should be non-null")
        }

        escaping = false
        escapeSpan = undefined
      } else {
        if (c == "\\") {
          escapeSpan = this.nextCharSpan
          escaping = true
        } else {
          chars.push(c)
        }
      }

      c = this.readChar()
    }

    return chars.join("")
  }

  /**
   * Reads literal string delimited by double quotes.
   * Supports '\\', '\n', '\t', '\"' and '\$' escapes
   */
  private readString(s: Source.Span) {
    let c = this.readChar()

    const strings: string[] = []
    const chars: string[] = []
    const tokens: Token[][] = []

    let escaping = false
    let escapeSpan: Source.Span | undefined = undefined

    while (!(!escaping && c == '"')) {
      if (c == "\0") {
        throw new CompilerError.Syntax(s, "unmatched '\"'")
        break
      }

      if (escaping) {
        if (c == "n") {
          chars.push("\n")
        } else if (c == "t") {
          chars.push("\t")
        } else if (c == "\\") {
          chars.push("\\")
        } else if (c == '"') {
          chars.push(c)
        } else if (c == "$") {
          chars.push(c)
        } else if (escapeSpan !== undefined) {
          throw new CompilerError.Syntax(
            this.mergeSpan(escapeSpan),
            `invalid escape sequence ${c}`
          )
        } else {
          throw new Error("escape site should be non-null")
        }

        escaping = false
        escapeSpan = undefined
      } else {
        if (c == "\\") {
          escapeSpan = this.nextCharSpan
          escaping = true
        } else if (c == "$" && this.peekChar() == "{") {
          this.readChar()
          strings.push(chars.join(""))
          chars.length = 0
          tokens.push(this.readTemplateInterpolation(s))
        } else {
          chars.push(c)
        }
      }

      c = this.readChar()
    }

    const sourceSpan = this.mergeSpan(s)
    if (tokens.length == 0) {
      this.pushToken({
        _tag: "PlainString",
        value: chars.join(""),
        sourceSpan
      })
    } else {
      strings.push(chars.join(""))

      this.pushToken({
        _tag: "TemplateString",
        strings,
        tokens,
        sourceSpan
      })
    }
  }

  private readTemplateInterpolation(templateStart: Source.Span): Token[] {
    const tokens: Token[] = []
    let depth = 0

    while (true) {
      const s = this.nextCharSpan
      const c = this.readChar()

      if (c == "\0") {
        throw new CompilerError.Syntax(
          this.mergeSpan(templateStart),
          "unterminated template string interpolation"
        )
        break
      }

      if (c == "}" && depth == 0) {
        break
      }

      const startLen = tokens.length

      const oldTokens = this.tokens
      this.tokens = tokens
      this.readToken(s, c)
      this.tokens = oldTokens

      for (let i = startLen; i < tokens.length; i++) {
        const token = tokens[i]

        if (token?._tag == "Symbol") {
          if (token.value == "{") {
            depth += 1
          } else if (token.value == "}") {
            depth -= 1
          }
        }
      }
    }

    return tokens
  }

  /**
   * Reads single or double character symbols
   */
  private readSymbol(start: Source.Span, c0: string) {
    const chars = [c0]

    const parseSecondChar = (second: string): boolean => {
      const d = this.readChar()

      if (d == second) {
        chars.push(d)
        return true
      } else {
        this.unreadChar()
        return false
      }
    }

    if (c0 == "|") {
      parseSecondChar("|")
    } else if (c0 == "&") {
      parseSecondChar("&")
    } else if (c0 == "=") {
      void (parseSecondChar("=") || parseSecondChar(">"))
    } else if (c0 == "!" || c0 == "<" || c0 == ">") {
      // could be !=, ==, <= or >=
      parseSecondChar("=")
    } else if (c0 == ":") {
      parseSecondChar(":")
    } else if (c0 == "-") {
      parseSecondChar(">")
    }

    this.pushToken({
      _tag: "Symbol",
      value: chars.join(""),
      sourceSpan: this.mergeSpan(start)
    })
  }
}

class CharReader {
  private readonly source: Source.Source
  private readonly sourceMap: Source.Map | undefined

  /**
   * Cached for speed
   */
  private readonly length: number

  /**
   * Split the content into chunks for more efficient reading
   */
  private readonly chunks: string[][]

  private readonly chunkSize: number

  /**
   * Character index, starts at 0
   */
  private pos: number

  constructor(
    source: Source.Source,
    sourceMap: Source.Map | undefined = undefined
  ) {
    this.source = source
    this.sourceMap = sourceMap

    // one-step split to utf-8 runes in the content
    const asCodePoints = [...source.content]

    // heuristic for chunk size
    this.chunkSize = Math.max(100, Math.floor(Math.sqrt(asCodePoints.length)))
    this.chunks = segmentArray(asCodePoints, this.chunkSize)
    this.length = asCodePoints.length

    this.pos = 0
  }

  /**
   * Returns the span of the next character that will be read (so pos:pos+1)
   */
  get span(): Source.Span {
    if (this.sourceMap) {
      return this.sourceMap.get(this.pos) ?? Source.DummySpan()
    } else {
      return {
        source: this.source,
        start: Math.min(this.length, this.pos),
        end: Math.min(this.length, this.pos + 1)
      }
    }
  }

  incr() {
    this.pos += 1
  }

  decr() {
    this.pos -= 1

    // throw a defect
    if (this.pos < 0) {
      throw new Error("invalid position in Source")
    }
  }

  /**
   * Reads a single char from the source and advances the index by one
   */
  read(): string {
    let c

    if (this.pos < this.length) {
      c = this.getChar(this.pos)
    } else {
      c = "\0"
    }

    this.incr()

    return c
  }

  /**
   * Doesn't advance pos
   */
  peek(): string {
    if (this.pos < this.length) {
      return this.getChar(this.pos)
    } else {
      return "\0"
    }
  }

  /**
   * Decreases value by one
   */
  unread() {
    this.decr()
  }

  /**
   * Get character from the underlying string index
   * Should work fine with utf-8 runes
   */
  private getChar(i: number): string {
    const targetChunk =
      i == this.length ? [] : this.chunks[Math.floor(i / this.chunkSize)]

    if (targetChunk === undefined || targetChunk.length == 0) {
      throw new Error(`invalid position in Source ${this.source.name}`)
    }

    const offset = i % this.chunkSize
    return targetChunk[offset]
  }
}

function segmentArray<T>(array: T[], segmentSize: number): T[][] {
  const n = array.length

  const segments: T[][] = []

  for (let i = 0; i < n; i += segmentSize) {
    segments.push(array.slice(i, i + segmentSize))
  }

  return segments
}
