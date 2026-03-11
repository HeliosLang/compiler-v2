import * as Source from "./Source.js"
import * as CompilerError from "./CompilerError.js"
import {
  Reader,
  anyName,
  bool,
  bytes,
  comment,
  group,
  int,
  newline,
  oneOf,
  real,
  symbol,
  str,
  templateString,
  word,
  type Group as ReaderGroup
} from "./Reader.js"
import * as Token from "./Token.js"

/**
 * A `Path` resolves to modules or to scoped symbols
 * Can be a single word, or multiple words separated by double colons
 */
export interface Path {
  readonly _tag: "Path"
  readonly names: Token.Word[]
  readonly separators: Token.Symbol<"::">[]
}

export function pathToString(p: Path) {
  return p.names.map((n) => n.value).join("::")
}

export function makePath(sourceSpan: Source.Span, value: string): Path {
  const parts = value.split("::")

  if (parts.length == 0 || parts.some((part) => part.length == 0)) {
    throw new Error(`invalid path '${value}'`)
  }

  return {
    _tag: "Path",
    names: parts.map((part) => ({
      _tag: "Word",
      value: part,
      sourceSpan
    })),
    separators: parts.slice(1).map(() => ({
      _tag: "Symbol",
      value: "::",
      sourceSpan
    }))
  }
}

export function extendPath(p: Path, name: Token.Word): Path {
  return {
    ...p,
    names: [...p.names, name],
    separators: [
      ...p.separators,
      { _tag: "Symbol", value: "::", sourceSpan: name.sourceSpan }
    ]
  }
}

/**
 * This is the root node of the Untyped AST
 */
export interface Script {
  readonly _tag: "Script"
  readonly kind: Token.Word<"validator" | "module">

  /**
   * Similar to Java package paths
   */
  readonly path: Path
  readonly statements: Statement[]
}

export function scriptName(script: Script): string {
  return pathToString(script.path)
}

export type Statement = Import | TopAssign | Declare | Token.Comment

/**
 * @param statement
 * @returns
 * The names injected by a statement into the script scope
 */
function statementNames(statement: Statement): Token.Word[] {
  switch (statement._tag) {
    case "Comment":
      return []
    case "Declare":
    case "Assign":
      return [statement.name]
    case "Import":
      return [statement.path.names[statement.path.names.length - 1]]
  }
}

export interface Import {
  readonly _tag: "Import"
  readonly import: Token.Word<"import">
  readonly path: Path
}

export interface TypeGuard {
  readonly colon: Token.Symbol<":">
  readonly type: Expression
}

/**
 * Assign the generic/type/value of the right-hand-side to the name in the left-hand-side
 */
export interface Assign {
  readonly _tag: "Assign"
  readonly name: Token.Word
  readonly type?: TypeGuard | undefined
  readonly equals: Token.Symbol<"=">
  readonly rhs: Expression
}

export interface TopAssign extends Assign {
  readonly export?: Token.Word<"export"> | undefined
}

/**
 * Declares a global variable without assigning a value
 *
 * Declared global variables are used as script parameters and can be used to set singleton values (avoiding such values being passed through function calls)
 */
export interface Declare {
  readonly _tag: "Declare"
  readonly export?: Token.Word<"export"> | undefined
  readonly name: Token.Word
  readonly type: TypeGuard
}

/**
 * Type application that turns a generic type into a concrete type
 */
export interface Apply {
  readonly _tag: "Apply"
  readonly gtype: Expression
  readonly args: Token.Group<"[", Expression>
}

// TODO: other common binary operators
export interface BinaryOp {
  readonly _tag: "BinaryOp"
  readonly left: Expression
  readonly op: Token.Symbol<"+" | "-" | "*" | "/">
  readonly right: Expression
}

/**
 * Function call expression
 */
export interface Call {
  readonly _tag: "Call"
  readonly fn: Expression
  readonly args: Token.Group<"(", Expression>
}

/**
 * Chain represents a chain of operations in a nested scope.
 *
 * The last expression cannot be `Assign` and determines the return value
 */
export interface Chain {
  readonly _tag: "Chain"
  readonly open: Token.Symbol<"{">
  readonly statements: (Assign | Call)[]
  readonly returns: Expression
  readonly close: Token.Symbol<"}">
}

/**
 * The `key` must be a Reference expression with a single word Path in all cases except Map construction
 */
export interface Construct {
  readonly _tag: "Construct"
  readonly type: Expression
  readonly args: Token.Group<
    "{",
    {
      readonly property?:
        | {
            key: Expression
            colon: Token.Symbol<":">
          }
        | undefined
      readonly value: Expression
    }
  >
}

/**
 * Enum type declaration that matches the ConstrData encoding
 */
export interface Enum {
  readonly _tag: "Enum"
  readonly enum: Token.Word<"enum">
  readonly open: Token.Symbol<"{">
  readonly variants: {
    readonly index?: {
      readonly value: Token.Int
      readonly colon: Token.Symbol<":">
    }
    readonly name: Token.Word
    readonly open: Token.Symbol<"{">
    readonly fields: {
      readonly name: Token.Word
      readonly type: TypeGuard
    }[]
    readonly close: Token.Symbol<"}">
  }[]
  readonly close: Token.Symbol<"}">
}

/**
 * Function type expression
 */
export interface FuncDecl {
  readonly _tag: "FuncDecl"
  readonly args: Token.Group<"(", Expression>
  readonly arrow: Token.Symbol<"->">
  readonly body: Expression
}

/**
 * Function value expression. Each arg must have a type.
 * TODO: a location for the return type?
 */
export interface FuncDef {
  readonly _tag: "FuncDef"
  readonly args: Token.Group<
    "(",
    {
      readonly name: Token.Word
      readonly type: TypeGuard
    }
  >
  readonly returns?: TypeGuard | undefined
  readonly arrow: Token.Symbol<"->">
  readonly body: Expression
}

/**
 * A generic type expression.
 *
 * The names in the bracket group will always have the DataLike typeclass (which isn't exposed to the user)
 */
export interface Generic {
  readonly _tag: "Generic"
  readonly args: Token.Group<"[", Token.Word>
  readonly arrow: Token.Symbol<"=>">
  readonly body: Expression
}

/**
 * Conventional if-else expression:
 *   if <condition> {} else {} | if <condition-2> {} else {} etc.
 */
export interface IfElse {
  readonly _tag: "IfElse"
  readonly if: Token.Word<"if">
  readonly condition: Expression
  readonly ifBranch: Chain
  readonly else: Token.Word<"else">
  readonly elseBranch: IfElse | Chain
}

export interface Literal {
  readonly _tag: "Literal"
  readonly value:
    | Token.Bool
    | Token.Bytes
    | Token.Int
    | Token.PlainString
    | Token.Real
}

/**
 * Object member access, which can also be used unwrap enums
 */
export interface Member {
  readonly _tag: "Member"
  readonly object: Expression
  readonly dot: Token.Symbol<".">
  readonly member: Token.Word
}

/**
 * A parentheses expression can be empty (unit), contain a single expression, or represent a tuple
 *
 * Parens can evaluate to either a type or an instance
 */
export interface Parens {
  readonly _tag: "Parens"
  readonly group: Token.Group<"(", Expression>
}

/**
 * Variable reference. In the simplest case this is just a word
 */
export interface Reference {
  readonly _tag: "Reference"
  readonly path: Path
}

/**
 * Struct type declaration that matches the ListData or MapData encoding
 */
export interface Struct {
  readonly _tag: "Struct"
  readonly struct: Token.Word<"struct">
  readonly open: Token.Symbol<"{">
  readonly fields: {
    readonly name: Token.Word
    readonly type: TypeGuard
    readonly key?: Token.PlainString | undefined
  }[]
  readonly close: Token.Symbol<"}">
}

export type TemplateString = Token.TemplateString<Expression>

export interface UnaryOp {
  _tag: "UnaryOp"
  op: Token.Symbol<"!" | "-">
  right: Expression
}

/**
 * Expressions can evaluate to generics, types and instances.
 */
export type Expression =
  | Apply
  | BinaryOp
  | Call
  | Chain
  | Construct
  | FuncDecl
  | FuncDef
  | Generic
  | IfElse
  | Literal
  | Member
  | Parens
  | Reference
  | TemplateString
  | UnaryOp

export function sourceSpan(node: Path | Expression): Source.Span {
  switch (node._tag) {
    case "Path":
      return Source.mergeSpan(
        node.names[0].sourceSpan,
        node.names[node.names.length - 1].sourceSpan
      )
    case "Apply":
      return Source.mergeSpan(
        node.args.open.sourceSpan,
        node.args.close.sourceSpan
      )
    case "BinaryOp":
      return node.op.sourceSpan
    case "Call":
      return Source.mergeSpan(
        node.args.open.sourceSpan,
        node.args.close.sourceSpan
      )
    case "Chain":
      return Source.mergeSpan(node.open.sourceSpan, node.close.sourceSpan)
    case "Construct":
      return Source.mergeSpan(
        node.args.open.sourceSpan,
        node.args.close.sourceSpan
      )
    case "FuncDecl":
      return node.arrow.sourceSpan
    case "FuncDef":
      return node.arrow.sourceSpan
    case "Generic":
      return node.arrow.sourceSpan
    case "IfElse":
      return node.if.sourceSpan
    case "Literal":
      return node.value.sourceSpan
    case "Member":
      return node.dot.sourceSpan
    case "Parens":
      return Source.mergeSpan(
        node.group.open.sourceSpan,
        node.group.close.sourceSpan
      )
    case "Reference":
      return sourceSpan(node.path)
    case "TemplateString":
      return node.sourceSpan
    case "UnaryOp":
      return node.op.sourceSpan
  }
}

export function parseScript(src: Source.Source): Script {
  const reader = new Reader(
    Token.tokenize(src, {
      preserveNewlines: true
    }),
    {
      ignoreNewlines: true
    }
  )

  const parse = new Parser()

  return parse.parseScript(reader)
}

/**
 * The parser methods call each recursively inside this class.
 *
 * The `Parser` class makes it easy to give the parsing additional context
 */
class Parser {
  constructor() {}

  parseScript(r: Reader): Script {
    return {
      _tag: "Script",
      kind: this.parseScriptKind(r),
      path: this.parsePath(r),
      statements: this.parseStatements(r)
    }
  }

  /**
   * - Assign with TypeGuard
   * - Assign without TypeGuard
   * - Declare with TypeGuard
   *
   * Note: TypeGuard can be any expression as long as it doesn't contain an equals sign, hence it's better to apply semicolon insertion to statements block
   */
  private parseAssignOrDeclare(r: Reader): Assign | Declare {
    return this.parseUntilSemicolonOrEof(r, (r: Reader) => {
      let m

      if ((m = r.findNext(symbol("=")))) {
        const lhs = m[0]
        const equals = m[1]
        const name = this.parseNonKeyword(lhs)
        const type = this.parseOptionalTypeGuard(lhs)

        lhs.end()

        const rhs = this.parseExpression(r)

        return {
          _tag: "Assign",
          name,
          equals,
          type,
          rhs
        } as Assign
      } else {
        // Declare
        if ((m = r.matches(anyName, symbol(":")))) {
          return {
            _tag: "Declare",
            name: m[0],
            type: {
              colon: m[1],
              type: this.parseExpression(r)
            }
          } as Declare
        } else {
          throw r.syntaxError(`Expected Assign or Declare statement`)
        }
      }
    })
  }

  private parseExpression(r: Reader): Expression {
    const ifWord = r.matches(word("if"))
    if (ifWord !== undefined) {
      return this.parseIfElse(ifWord, r)
    }

    const genericExpr = r.matches(group("["), symbol("=>"))
    if (genericExpr !== undefined) {
      const args = genericExpr[0]
      const arrow = genericExpr[1]

      return {
        _tag: "Generic",
        args: {
          _tag: "Group",
          open: args.open,
          separators: args.separators,
          close: args.close,
          fields: args.fields.map((field) => {
            const name = this.parseNonKeyword(field)

            field.end()

            return name
          })
        },
        arrow,
        body: this.parseExpression(r)
      }
    }

    const fnExpr = r.matches(group("("), symbol("->"))
    if (fnExpr !== undefined) {
      return this.parseFunc(fnExpr[0], fnExpr[1], r)
    }

    const fnDefExpr = r.matches(group("("), symbol(":"))
    if (fnDefExpr !== undefined) {
      return this.parseFuncDef(fnDefExpr[0], fnDefExpr[1], r)
    }

    return this.parseAddSub(r)
  }

  private parseAddSub(r: Reader): Expression {
    let left = this.parseMulDiv(r)
    let m

    while ((m = r.matches(oneOf([symbol("+"), symbol("-")])))) {
      left = {
        _tag: "BinaryOp",
        left,
        op: m,
        right: this.parseMulDiv(r)
      }
    }

    return left
  }

  private parseMulDiv(r: Reader): Expression {
    let left = this.parseUnary(r)
    let m

    while ((m = r.matches(oneOf([symbol("*"), symbol("/")])))) {
      left = {
        _tag: "BinaryOp",
        left,
        op: m,
        right: this.parseUnary(r)
      }
    }

    return left
  }

  private parseUnary(r: Reader): Expression {
    const m = r.matches(oneOf([symbol("!"), symbol("-")]))

    if (m !== undefined) {
      return {
        _tag: "UnaryOp",
        op: m,
        right: this.parseUnary(r)
      }
    }

    return this.parsePostfix(r)
  }

  private parsePostfix(r: Reader): Expression {
    let expr = this.parsePrimary(r)

    while (true) {
      const applyGroup = r.matches(group("["))
      if (applyGroup !== undefined) {
        expr = {
          _tag: "Apply",
          gtype: expr,
          args: {
            ...applyGroup,
            _tag: "Group",
            fields: applyGroup.fields.map((field) => {
              const arg = this.parseExpression(field)

              field.end()

              return arg
            })
          }
        }
        continue
      }

      const callGroup = r.matches(group("("))
      if (callGroup !== undefined) {
        expr = {
          _tag: "Call",
          fn: expr,
          args: {
            ...callGroup,
            _tag: "Group",
            fields: callGroup.fields.map((field) => {
              const arg = this.parseExpression(field)

              field.end()

              return arg
            })
          }
        }
        continue
      }

      const member = r.matches(symbol("."), anyName)
      if (member !== undefined) {
        expr = {
          _tag: "Member",
          object: expr,
          dot: member[0],
          member: member[1]
        }
        continue
      }

      const construct = r.matches(group("{"))

      if (construct !== undefined) {
        expr = {
          _tag: "Construct",
          type: expr,
          args: {
            ...construct,
            _tag: "Group",
            fields: construct.fields.map((field) => {
              const p = field.findNext(symbol(":"))

              let property:
                | { key: Expression; colon: Token.Symbol<":"> }
                | undefined = undefined

              if (p !== undefined) {
                const [keyReader, colon] = p
                const key = this.parseExpression(keyReader)
                keyReader.end()

                property = {
                  key,
                  colon
                }
              }

              const value = this.parseExpression(field)
              field.end()

              return {
                property,
                value
              }
            })
          }
        }

        continue
      }

      break
    }

    return expr
  }

  private parsePrimary(r: Reader): Expression {
    const literal = r.matches(oneOf([bool(), bytes, int(), str(), real]))
    if (literal !== undefined) {
      return {
        _tag: "Literal",
        value: literal
      }
    }

    const template = r.matches(templateString)
    if (template !== undefined) {
      return {
        ...template,
        tokens: template.tokens.map((tokens) => {
          const field = new Reader(tokens, r.config)
          const expr = this.parseExpression(field)

          field.end()

          return expr
        })
      }
    }

    const chain = r.matches(group("{"))
    if (chain !== undefined) {
      return this.parseChainFromGroup(chain)
    }

    const parens = r.matches(group("("))
    if (parens !== undefined) {
      return {
        _tag: "Parens",
        group: {
          _tag: "Group",
          open: parens.open,
          separators: parens.separators,
          close: parens.close,
          fields: parens.fields.map((field) => {
            const value = this.parseExpression(field)

            field.end()

            return value
          })
        }
      }
    }

    const name = r.matches(anyName)
    if (name !== undefined) {
      r.unreadToken()

      return {
        _tag: "Reference",
        path: this.parsePath(r)
      }
    }

    throw r.syntaxError(`Expected expression`)
  }

  private parseIfElse(ifWord: Token.Word<"if">, r: Reader): IfElse {
    const condition = this.parseExpression(r)

    const trueBranch = this.parseChain(r)

    const elseWord = r.matches(word("else"))

    if (elseWord === undefined) {
      throw r.syntaxError(`Expected 'else'`)
    }

    let falseBranch: IfElse | Chain

    const nested = r.matches(word("if"))

    if (nested !== undefined) {
      falseBranch = this.parseIfElse(nested, r)
    } else {
      falseBranch = this.parseChain(r)
    }

    return {
      _tag: "IfElse",
      if: ifWord,
      condition,
      ifBranch: trueBranch,
      else: elseWord,
      elseBranch: falseBranch
    }
  }

  private parseChain(r: Reader): Chain {
    const g = r.matches(group("{"))

    if (g === undefined) {
      throw r.syntaxError(`Expected '{' chain`)
    }

    return this.parseChainFromGroup(g)
  }

  private parseChainFromGroup(group: ReaderGroup<"{">): Chain {
    const segments: Reader[] = []

    if (group.fields.length == 0) {
      throw new Error("Empty chain body")
    }

    if (group.fields.length > 1) {
      const comma = group.separators[0] ?? group.open
      throw new CompilerError.Syntax(
        comma.sourceSpan,
        "Unexpected ',' in chain body"
      )
    } else {
      const body = group.fields[0].insertSemicolons(["=", "+", "&&", ":"])

      while (!body.isEof()) {
        const part = body.readUntil(symbol(";"))

        if (part.rest.length > 0) {
          segments.push(part)
        }

        if (!body.matches(symbol(";"))) {
          break
        }
      }
    }

    if (segments.length == 0) {
      throw new Error("Empty chain body")
    }

    const statements: (Assign | Call)[] = []

    for (let i = 0; i < segments.length - 1; i++) {
      statements.push(this.parseChainStatement(segments[i]))
    }

    const returnsReader = segments[segments.length - 1]
    const returns = this.parseExpression(returnsReader)

    returnsReader.end()

    return {
      _tag: "Chain",
      open: group.open,
      statements,
      returns,
      close: group.close
    }
  }

  private parseChainStatement(r: Reader): Assign | Call {
    const m = r.findNext(symbol("="))

    if (m !== undefined) {
      const [lhs, equals] = m

      const name = this.parseNonKeyword(lhs)
      const type = this.parseOptionalTypeGuard(lhs)

      lhs.end()

      const rhs = this.parseExpression(r)

      r.end()

      return {
        _tag: "Assign",
        name,
        type,
        equals,
        rhs
      }
    }

    const expr = this.parseExpression(r)

    r.end()

    if (expr?._tag != "Call") {
      throw r.syntaxError(`Expected assignment or call statement`)
    }

    return expr
  }

  private parseFunc(
    argsGroup: ReaderGroup<"(">,
    arrow: Token.Symbol<"->">,
    r: Reader
  ): FuncDecl | FuncDef {
    const body = this.parseExpression(r)

    let isDef = true
    const defArgs: { name: Token.Word; type: TypeGuard }[] = []
    const declArgs: Expression[] = []

    for (const field of argsGroup.fields) {
      let m

      if ((m = field.matches(anyName, symbol(":")))) {
        defArgs.push({
          name: m[0],
          type: {
            colon: m[1],
            type: this.parseExpression(field)
          }
        })
      } else {
        isDef = false
        declArgs.push(this.parseExpression(field))
      }
    }

    if (isDef) {
      return {
        _tag: "FuncDef",
        args: {
          ...argsGroup,
          fields: defArgs
        },
        arrow,
        body
      }
    } else {
      return {
        _tag: "FuncDecl",
        args: {
          ...argsGroup,
          fields: declArgs
        },
        arrow,
        body
      }
    }
  }

  private parseFuncDef(
    argsGroup: ReaderGroup<"(">,
    colon: Token.Symbol<":">,
    r: Reader
  ): FuncDef {
    const m = r.findNext(symbol("->"))

    if (m === undefined) {
      throw r.syntaxError("Expected '->' after '(...):' ")
    }

    const arrow = m[1]

    const typeExpr = this.parseExpression(m[0])
    m[0].end()

    const defArgs: { name: Token.Word; type: TypeGuard }[] = []

    for (const field of argsGroup.fields) {
      let m

      if ((m = field.matches(anyName, symbol(":")))) {
        defArgs.push({
          name: m[0],
          type: {
            colon: m[1],
            type: this.parseExpression(field)
          }
        })
      } else {
        throw field.syntaxError("Expected '<name>: <type>'")
      }
    }

    const body = this.parseExpression(r)

    return {
      _tag: "FuncDef",
      args: {
        ...argsGroup,
        fields: defArgs
      },
      returns: {
        colon,
        type: typeExpr
      },
      arrow,
      body
    }
  }

  private parseOptionalTypeGuard(r: Reader): TypeGuard | undefined {
    let m

    if ((m = r.matches(symbol(":")))) {
      const type = this.parseExpression(r)

      return {
        colon: m,
        type
      } as TypeGuard
    } else {
      return undefined
    }
  }

  /**
   * TODO: support more advanced import syntax
   * @param kw
   * @returns
   */
  private parseImport(kw: Token.Word<"import">, r: Reader): Import {
    const path = this.parseUntilSemicolonOrEof(r, (r) => this.parsePath(r))

    return {
      _tag: "Import",
      import: kw,
      path
    }
  }

  private parseUntilSemicolonOrEof<T>(
    r: Reader,
    callback: (r: Reader) => T
  ): T {
    const m = r.findNext(symbol(";"))

    if (m !== undefined) {
      ;[r] = m
    }

    const result: T = callback(r)

    r.end()

    return result
  }

  private parseExport(
    kw: Token.Word<"export">,
    r: Reader
  ): TopAssign | Declare {
    return {
      ...this.parseAssignOrDeclare(r),
      export: kw
    }
  }

  private parseNonKeyword(r: Reader): Token.Word {
    const m = r.matches(anyName)

    if (m === undefined) {
      throw r.syntaxError(`Invalid name`)
    }

    return m
  }

  private parsePath(r: Reader): Path {
    const names: Token.Word[] = [this.parseNonKeyword(r)]
    const separators: Token.Symbol<"::">[] = []

    let m

    while ((m = r.matches(symbol("::")))) {
      separators.push(m)
      names.push(this.parseNonKeyword(r))
    }

    return {
      _tag: "Path",
      names,
      separators
    }
  }

  private parseScriptKind(r: Reader): Token.Word<"validator" | "module"> {
    const m = r.matches(oneOf([word("validator"), word("module")]))

    if (m === undefined) {
      throw r.syntaxError(
        `Invalid script header, expected 'validator' or 'module'`
      )
    }

    return m
  }

  private parseStatements(r: Reader): Statement[] {
    r = r.insertSemicolons(["=", "+", "&&", ":", "->"])

    let m

    const statements: Statement[] = []

    while (!r.isEof()) {
      if (r.matches(symbol(";"))) {
        continue // absorb spurious semicolons without throwing an error
      } else if (r.matches(newline)) {
        continue // newlines can separate top-level statements
      } else if ((m = r.matches(comment))) {
        statements.push(m)
      } else if ((m = r.matches(word("import")))) {
        statements.push(this.parseImport(m, r))
      } else if ((m = r.matches(word("export")))) {
        statements.push(this.parseExport(m, r))
      } else {
        statements.push(this.parseAssignOrDeclare(r))
      }
    }

    const names = new Map<string, Token.Word>()

    for (const statement of statements) {
      for (const name of statementNames(statement)) {
        if (names.has(name.value)) {
          throw new CompilerError.Reference(
            name.sourceSpan,
            `'${name.value}' already defined`
          )
        }

        names.set(name.value, name)
      }
    }

    return statements
  }
}
