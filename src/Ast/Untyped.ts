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

export type Statement = Import | Export | Assign | Declare | Token.Comment

export interface Import {
  readonly _tag: "Import"
  readonly import: Token.Word<"import">
  readonly path: Path
}

export interface Export {
  readonly _tag: "Export"
  readonly export: Token.Word<"export">
  readonly statement: Assign | Declare
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

/**
 * Declares a global variable without assigning a value
 * 
 * Declared global variables are used as script parameters and can be used to set singleton values (avoiding such values being passed through function calls)
 */
export interface Declare {
  readonly _tag: "Declare"
  readonly name: Token.Word
  readonly type: TypeGuard
}

/**
 * Expressions can evaluate to generics, types and instances.
 */
export type Expression = BinaryOp | Call | Chain | FuncDecl | FuncDef | Generic | IfElse | Literal | Member | Parens | Reference | TemplateString | UnaryOp

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
  readonly args: Token.Group<"{", {
    readonly property?: {
      key: Expression
      colon: Token.Symbol<":">
    } | undefined
    readonly value: Expression
  }, ",">
}

/**
 * Function type expression
 */
export interface FuncDecl {
  readonly args: Token.Group<"(", Expression>
  readonly arrow: Token.Symbol<"->">
  readonly body: Expression
}

/**
 * Function value expression. Each arg must have a type.
 * TODO: a location for the return type?
 */
export interface FuncDef {
  readonly args: Token.Group<"(", {
    readonly name: Token.Word
    readonly type: TypeGuard
  }>
  readonly arrow: Token.Symbol<"->">
  readonly body: Expression
}

/**
 * A generic type expression.
 * 
 * The names in the bracket group will always have the DataLike typeclass (which isn't exposed to the user)
 */
export interface Generic {
  _tag: "Generic"
  args: Token.Group<"[", Token.Word>
  arrow: Token.Symbol<"=>">
  body: Expression
}

/**
 * Conventional if-else expression: 
 *   if <condition> {} else {} | if <condition-2> {} else {} etc.
 */
export interface IfElse {
  _tag: "IfElse"
  if: Token.Word<"if">
  condition: Expression
  trueBranch: Chain
  else: Token.Word<"else">
  falseBranch: IfElse | Chain
}

export interface Literal {
  _tag: "Literal"
  value: Token.Bool | Token.Bytes | Token.Int | Token.PlainString | Token.Real 
}

/**
 * Object member access, which can also be used unwrap enums
 */
export interface Member {
  _tag: "Member"
  object: Expression
  dot: Token.Symbol<".">
  member: Token.Word
}

/**
 * A parentheses expression can be empty (unit), contain a single expression, or represent a tuple
 * 
 * Parens can evaluate to either a type or an instance
 */
export interface Parens {
  _tag: "Parens"
  group: Token.Group<"(", Expression>
}

/**
 * Variable reference. In the simplest case this is just a word
 */
export interface Reference {
  _tag: "Reference"
  path: Path
}

export type TemplateString = Token.TemplateString<Expression>

export interface UnaryOp {
  _tag: "UnaryOp"
  op: Token.Symbol<"!" | "-">
  right: Expression
}
