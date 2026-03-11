import * as Source from "./Source.js"
import * as CompilerError from "./CompilerError.js"
import {
  Reader,
  bool,
  bytes,
  group,
  int,
  oneOf,
  str,
  symbol,
  word
} from "./Reader.js"
import * as Token from "./Token.js"
import * as Uplc from "./Uplc.js"

export interface Call {
  readonly _tag: "Call"
  readonly fn: Expression
  readonly args: Token.Group<"(", Expression>
}

export interface Error {
  readonly _tag: "Error"
  readonly error: Token.Word<"error">
  readonly open: Token.Symbol<"(">
  readonly close: Token.Symbol<")">
}

export interface FuncDef {
  readonly _tag: "FuncDef"
  readonly args: Token.Group<"(", Token.Word>
  readonly arrow: Token.Symbol<"->">
  readonly body: {
    readonly open: Token.Symbol<"{">
    readonly expr: Expression
    readonly close: Token.Symbol<"}">
  }
}

export interface Literal {
  readonly _tag: "Literal"
  readonly sourceSpan: Source.Span
  readonly value: Uplc.Value
}

export interface Reference {
  readonly _tag: "Reference"
  readonly name: Token.Word

  /**
   * Determined during parsing step
   */
  readonly isCalled?: boolean | undefined

  /**
   * Determined during resolution step
   */
  readonly isBuiltin?: boolean | undefined
  readonly isSpecial?: boolean | undefined

  /**
   * Raw definitions can specify certain builtins as not throwing errors by using an exclamation mark suffix
   *
   * This allows more aggressive optimizations
   */
  readonly isSafe?: boolean | undefined
}

export type Expression = Call | Error | FuncDef | Literal | Reference

const SPECIAL_TERMS = new Set<string>(["case", "constr"])

export function parse(src: Source.Source): Expression {
  const reader = new Reader(
    Token.tokenize(src, {
      extraValidFirstLetters: "[@$:]",
      preserveNewlines: true,
      tokenizeReal: false,
      preserveComments: false,
      allowLeadingZeroes: false
    }),
    {
      ignoreNewlines: true
    }
  )

  const parser = new Parser()
  const expr = parser.parseExpression(reader)

  reader.end()

  return expr
}

export function parseExpression(src: Source.Source): Expression {
  return parse(src)
}

export function resolveNames(
  expr: Expression,
  scopeNames: Iterable<string> = []
): Expression {
  const resolver = new Resolver(new Set(scopeNames))
  return resolver.resolveExpression(expr)
}

export function generateUplc(
  expr: Expression,
  scopeNames: Iterable<string> = []
): Uplc.Term {
  const scope = Array.from(scopeNames)
  return new Generator().expression(resolveNames(expr, scope), scope)
}

class Parser {
  parseExpression(r: Reader): Expression {
    const m = r.matches(group("("), symbol("->"))

    if (m !== undefined) {
      return this.parseFuncDef(m[0], m[1], r)
    }

    return this.parsePostfix(r)
  }

  private parsePostfix(r: Reader): Expression {
    let expr = this.parsePrimary(r)

    while (true) {
      const args = r.matches(group("("))

      if (args === undefined) {
        break
      }

      expr = {
        _tag: "Call",
        fn: expr,
        args: {
          ...args,
          fields: args.fields.map((field) => {
            const arg = this.parseExpression(field)
            field.end()
            return arg
          })
        }
      }
    }

    return expr
  }

  private parsePrimary(r: Reader): Expression {
    const literal = r.matches(oneOf([bool(), bytes, int(), str()]))

    if (literal !== undefined) {
      return this.parseLiteral(literal)
    }

    const w = r.matches(word())
    if (w !== undefined) {
      if (w.value == "error") {
        const args = r.matches(group("("))

        if (args === undefined) {
          throw r.syntaxError("Expected '()' after 'error'")
        }

        if (args.fields.length != 0) {
          throw new CompilerError.Syntax(
            args.open.sourceSpan,
            "Expected empty argument list for error()"
          )
        }

        return {
          _tag: "Error",
          error: w as Token.Word<"error">,
          open: args.open,
          close: args.close
        }
      }

      const safe = r.matches(symbol("!"))
      const lookedAheadCall = r.matches(group("("))
      const isCalled = lookedAheadCall !== undefined

      if (lookedAheadCall !== undefined) {
        r.unreadToken()
      }

      return {
        _tag: "Reference",
        name: w,
        isCalled,
        isSafe: safe !== undefined ? true : undefined
      }
    }

    const g = r.matches(group("("))

    if (g !== undefined) {
      if (g.fields.length == 0) {
        return {
          _tag: "Literal",
          sourceSpan: Source.mergeSpan(g.open.sourceSpan, g.close.sourceSpan),
          value: {
            _tag: "Unit"
          }
        }
      }

      if (g.fields.length > 1) {
        const comma = g.separators[0] ?? g.open

        throw new CompilerError.Syntax(
          comma.sourceSpan,
          "Expected one expression in parentheses"
        )
      }

      const field = g.fields[0]
      if (field === undefined) {
        throw new Error("unreachable")
      }
      const expr = this.parseExpression(field)
      field.end()

      return expr
    }

    throw r.syntaxError("Expected IR expression")
  }

  private parseFuncDef(
    argsGroup: Token.Group<"(", Reader>,
    arrow: Token.Symbol<"->">,
    r: Reader
  ): FuncDef {
    const args: Token.Word[] = argsGroup.fields.map((field) => {
      const arg = field.matches(word())

      if (arg === undefined) {
        throw field.syntaxError("Expected function argument name")
      }

      field.end()

      return arg
    })

    const body = r.matches(group("{"))
    if (body === undefined) {
      throw r.syntaxError("Expected function body '{ ... }'")
    }

    if (body.fields.length > 1) {
      const comma = body.separators[0] ?? body.open
      throw new CompilerError.Syntax(
        comma.sourceSpan,
        "Expected a single expression in function body"
      )
    }

    const field = body.fields[0]
    if (field === undefined) {
      throw new CompilerError.Syntax(
        body.open.sourceSpan,
        "Expected a single expression in function body"
      )
    }

    const expr = this.parseExpression(field)
    field.end()

    return {
      _tag: "FuncDef",
      args: {
        ...argsGroup,
        _tag: "Group",
        fields: args
      },
      arrow,
      body: {
        open: body.open,
        expr,
        close: body.close
      }
    }
  }

  private parseLiteral(
    token: Token.Bool | Token.Bytes | Token.Int | Token.PlainString
  ): Literal {
    switch (token._tag) {
      case "Bool":
        return {
          _tag: "Literal",
          sourceSpan: token.sourceSpan,
          value: {
            _tag: "Bool",
            value: token.value
          }
        }
      case "Bytes":
        // don't support double bytes UplcData parsing like the legacy compiler, because in this compiler Uplc.Value will be injected directly
        return {
          _tag: "Literal",
          sourceSpan: token.sourceSpan,
          value: {
            _tag: "ByteArray",
            value: token.value
          }
        }
      case "Int":
        return {
          _tag: "Literal",
          sourceSpan: token.sourceSpan,
          value: {
            _tag: "Int",
            value: token.value
          }
        }
      case "PlainString":
        return {
          _tag: "Literal",
          sourceSpan: token.sourceSpan,
          value: {
            _tag: "String",
            value: token.value
          }
        }
    }
  }
}

class Resolver {
  readonly scope: Set<string>

  constructor(scope: Set<string>) {
    this.scope = scope
  }

  resolveExpression(expr: Expression): Expression {
    switch (expr._tag) {
      case "Call":
        return this.resolveCall(expr)
      case "Error":
        return expr
      case "FuncDef":
        return this.resolveFuncDef(expr)
      case "Literal":
        return expr
      case "Reference":
        return this.resolveReference(expr)
    }
  }

  private resolveCall(expr: Call): Call {
    return {
      ...expr,
      fn: this.resolveExpression(expr.fn),
      args: {
        ...expr.args,
        fields: expr.args.fields.map((arg) => this.resolveExpression(arg))
      }
    }
  }

  private resolveFuncDef(expr: FuncDef): FuncDef {
    const nextScope = new Set(this.scope)
    expr.args.fields.forEach((arg) => nextScope.add(arg.value))

    const bodyResolver = new Resolver(nextScope)

    return {
      ...expr,
      body: {
        ...expr.body,
        expr: bodyResolver.resolveExpression(expr.body.expr)
      }
    }
  }

  private resolveReference(expr: Reference): Reference {
    if (this.scope.has(expr.name.value)) {
      return expr
    }

    if (Uplc.BUILTIN_NAMES.some((builtin) => builtin.name == expr.name.value)) {
      return {
        ...expr,
        isBuiltin: true
      }
    }

    if (SPECIAL_TERMS.has(expr.name.value)) {
      if (expr.isCalled !== true) {
        throw new CompilerError.Syntax(
          expr.name.sourceSpan,
          `Special term '${expr.name.value}' must be called`
        )
      }

      return {
        ...expr,
        isSpecial: true
      }
    }

    throw new CompilerError.Reference(
      expr.name.sourceSpan,
      `'${expr.name.value}' undefined`
    )
  }
}

class Generator {
  expression(expr: Expression, scope: readonly string[]): Uplc.Term {
    switch (expr._tag) {
      case "Call":
        return this.call(expr, scope)
      case "Error":
        return {
          _tag: "Error",
          sourceSpan: toUplcSourceSpan(expressionSourceSpan(expr))
        }
      case "FuncDef":
        return this.funcDef(expr, scope)
      case "Literal":
        return {
          _tag: "Const",
          value: expr.value,
          sourceSpan: toUplcSourceSpan(expr.sourceSpan)
        }
      case "Reference":
        return this.reference(expr, scope)
    }
  }

  private call(expr: Call, scope: readonly string[]): Uplc.Term {
    if (expr.fn._tag == "Reference" && expr.fn.isSpecial === true) {
      const sourceSpan = toUplcSourceSpan(expressionSourceSpan(expr))

      switch (expr.fn.name.value) {
        case "case": {
          const [arg, ...cases] = expr.args.fields

          if (arg === undefined) {
            throw new CompilerError.Syntax(
              expr.args.open.sourceSpan,
              "Expected at least one argument for case()"
            )
          }

          return {
            _tag: "Case",
            arg: this.expression(arg, scope),
            cases: cases.map((branch) => this.expression(branch, scope)),
            sourceSpan
          }
        }
        case "constr": {
          const [tagExpr, ...args] = expr.args.fields

          if (
            tagExpr === undefined ||
            tagExpr._tag != "Literal" ||
            tagExpr.value._tag != "Int"
          ) {
            throw new CompilerError.Syntax(
              tagExpr !== undefined
                ? expressionSourceSpan(tagExpr)
                : expr.args.open.sourceSpan,
              "Expected integer literal tag as first argument of constr()"
            )
          }

          const tag = Number(tagExpr.value.value)

          if (!Number.isSafeInteger(tag)) {
            throw new CompilerError.Syntax(
              tagExpr.sourceSpan,
              "Expected constr() tag to be a safe integer"
            )
          }

          return {
            _tag: "Constr",
            tag,
            args: args.map((arg) => this.expression(arg, scope)),
            sourceSpan
          }
        }
        default:
          throw new Error(`unexpected special term ${expr.fn.name.value}`)
      }
    }

    const sourceSpan = toUplcSourceSpan(expressionSourceSpan(expr))
    let term = this.expression(expr.fn, scope)

    if (expr.args.fields.length == 0) {
      return {
        _tag: "Force",
        arg: term,
        sourceSpan
      }
    }

    for (let i = 0; i < expr.args.fields.length; i++) {
      const arg = expr.args.fields[i]

      if (arg === undefined) {
        continue
      }

      term = {
        _tag: "Apply",
        fn: term,
        arg: this.expression(arg, scope),
        sourceSpan: i == expr.args.fields.length - 1 ? sourceSpan : undefined
      }
    }

    return term
  }

  private funcDef(expr: FuncDef, scope: readonly string[]): Uplc.Term {
    const sourceSpan = toUplcSourceSpan(expressionSourceSpan(expr))
    const nextScope = scope.concat(expr.args.fields.map((arg) => arg.value))
    let term = this.expression(expr.body.expr, nextScope)

    if (expr.args.fields.length == 0) {
      return {
        _tag: "Delay",
        arg: term,
        sourceSpan
      }
    }

    for (let i = expr.args.fields.length - 1; i >= 0; i--) {
      const arg = expr.args.fields[i]

      if (arg === undefined) {
        continue
      }

      term = {
        _tag: "Lambda",
        body: term,
        argName: arg.value,
        sourceSpan
      }
    }

    return term
  }

  private reference(expr: Reference, scope: readonly string[]): Uplc.Term {
    const sourceSpan = toUplcSourceSpan(expr.name.sourceSpan)

    if (expr.isBuiltin === true) {
      const builtin = Uplc.BUILTIN_NAMES.find(
        (builtin) => builtin.name == expr.name.value
      )

      if (builtin === undefined) {
        throw new CompilerError.Reference(
          expr.name.sourceSpan,
          `builtin '${expr.name.value}' not found`
        )
      }

      let term: Uplc.Term = {
        _tag: "Builtin",
        id: Uplc.BUILTIN_NAMES.indexOf(builtin),
        name: builtin.name,
        sourceSpan
      }

      for (let i = 0; i < builtin.nForces; i++) {
        term = {
          _tag: "Force",
          arg: term,
          sourceSpan
        }
      }

      return term
    }

    if (expr.isSpecial === true) {
      throw new CompilerError.Syntax(
        expr.name.sourceSpan,
        `Special term '${expr.name.value}' must be called`
      )
    }

    for (let i = scope.length - 1; i >= 0; i--) {
      if (scope[i] == expr.name.value) {
        return {
          _tag: "Var",
          index: scope.length - i,
          name: expr.name.value,
          sourceSpan
        }
      }
    }

    throw new CompilerError.Reference(
      expr.name.sourceSpan,
      `'${expr.name.value}' undefined`
    )
  }
}

function expressionSourceSpan(expr: Expression): Source.Span {
  switch (expr._tag) {
    case "Call":
      return Source.mergeSpan(
        expressionSourceSpan(expr.fn),
        expr.args.close.sourceSpan
      )
    case "Error":
      return Source.mergeSpan(expr.error.sourceSpan, expr.close.sourceSpan)
    case "FuncDef":
      return Source.mergeSpan(
        expr.args.open.sourceSpan,
        expr.body.close.sourceSpan
      )
    case "Literal":
      return expr.sourceSpan
    case "Reference":
      return expr.name.sourceSpan
  }
}

function toUplcSourceSpan(span: Source.Span): Uplc.SourceSpan | undefined {
  if (Source.isDummySpan(span)) {
    return undefined
  }

  const start = offsetToLineColumn(span.source.content, span.start)
  const end = offsetToLineColumn(span.source.content, span.end)

  return {
    file: span.source.name,
    start,
    end
  }
}

function offsetToLineColumn(
  content: string,
  offset: number
): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, content.length))
  let line = 1
  let column = 1

  for (let i = 0; i < clamped; i++) {
    if (content[i] == "\n") {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }

  return { line, column }
}
