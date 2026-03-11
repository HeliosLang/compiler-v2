import * as Source from "../Source/index.js"
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

    if (Uplc.BUILTIN_NAMES.includes(expr.name.value)) {
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
