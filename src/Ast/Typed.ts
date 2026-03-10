import * as Source from "../Source/index.js"
import * as CompilerError from "./CompilerError.js"
import * as Token from "./Token.js"
import * as Untyped from "./Untyped.js"

// the next step is to convert an Untyped AST into a Typed AST,
//   throwing type and reference errors in the process
// The entry point requires a global scope object

// We must start by defining what types are
export type SymbolValue = Namespace | Typed | Type | GenericType

export function isType(value: SymbolValue) {
  return value._tag == "DataType" || value._tag == "FuncType"
}

export interface Namespace {
  readonly _tag: "Namespace"
  readonly members: Scope
}

/**
 * Instances are encodeable as data, and can have members
 */
export interface Typed<T extends Type = Type> {
  readonly _tag: "Typed"
  readonly type: T
  readonly path?: Path
}

export type Type = DataType | FuncType

export interface DataType {
  readonly _tag: "DataType"

  /**
   * The global path of the type (imports only provide aliased types)
   *
   * Comparing path should be good enough for uniqueness
   */
  readonly path: Path

  /**
   * Tuple can be encoded by using integer keys
   */
  readonly properties: Record<string, DataType>

  readonly variants: Record<string, DataType>
}



function isBool(typed: Typed): typed is Typed<DataType> {
  return isBoolType(typed.type)
}

function isBoolType(type: Type): type is DataType {
  return type._tag == "DataType" && pathToString(type.path) == "Bool"
}

function isDataType(type: Type): type is DataType {
  return type._tag == "DataType"
}

function isListType(type: Type): type is DataType {
  return type._tag == "DataType" && type.path.names[0].value == "List"
}

function isMapType(type: Type): type is DataType {
  return type._tag == "DataType" && type.path.names[0].value == "Map"
}

function isUnitType(type: Type): type is DataType {
  return type._tag == "DataType" && pathToString(type.path) == "Unit"
}

export interface FuncType {
  readonly _tag: "FuncType"
  readonly args: Type[]
  readonly returns: Type
}

export interface GenericType {
  readonly _tag: "GenericType"
  readonly nArgs: number
  readonly type: (args: DataType[]) => Type
}

function isInstanceOf(typed: Typed, type: Type) {
  return isAssignableTo(typed.type, type)
}

function isAssignableTo(type: Type, target: Type): boolean {
  if (type._tag == "DataType" && target._tag == "DataType") {
    return type.path == target.path
  } else if (type._tag == "FuncType" && target._tag == "FuncType") {
    return (
      type.args.length == target.args.length &&
      type.args.every((a, i) => isAssignableTo(target.args[i], a)) &&
      isAssignableTo(type.returns, target.returns)
    )
  } else {
    return false
  }
}

export interface Path extends Untyped.Path {
  /**
   * Only DataTypes can be applied to generic structs/enums/tuples
   * 
   * In therory any Type can be applied to generic functions, but that leads to whole other range of problems
   */
  appliedTypes?: DataType[]
}

export function pathToString(path: Path): string {
  return `${Untyped.pathToString(path)}${path.appliedTypes && path.appliedTypes.length > 0 ? `[${path.appliedTypes.map(t => pathToString(t.path)).join("][")}]` : ""}`
}

export interface Script extends Omit<Untyped.Script, "statements"> {
  readonly statements: Statement[]
  readonly resolved: Namespace
}

export type Statement = Import | TopAssign | Declare | Token.Comment

/**
 * Created during the first pass of resolving the top-level statements of a script
 */
type StatementFirstPass = Import | TopAssignFirstPass | Declare | Token.Comment

export interface Import extends Untyped.Import {
  readonly namespace: Namespace
}

export interface TypeGuard extends Omit<Untyped.TypeGuard, "type"> {
  readonly type: Expression
  readonly resolved: Type
}

export interface Assign extends Omit<Untyped.Assign, "rhs" | "type"> {
  readonly type?: TypeGuard | undefined
  readonly rhs: Expression
}

export interface TopAssign extends Assign {
  readonly export?: Token.Word<"export"> | undefined
  readonly path: Path
}

interface TopAssignFirstPass extends Omit<TopAssign, "rhs"> {
  readonly rhs: TopAssignRhsFirstPass
  readonly path: Path
}

export interface Declare extends Omit<Untyped.Declare, "type"> {
  readonly type: TypeGuard
  readonly path: Path
}

export interface Apply extends Omit<Untyped.Apply, "gtype" | "args"> {
  readonly gtype: Expression
  readonly args: Token.Group<"[", Expression>
  readonly resolved: Type
}

export interface BinaryOp extends Omit<Untyped.BinaryOp, "left" | "right"> {
  readonly left: InstanceExpression
  readonly right: InstanceExpression
  readonly resolved: Typed<DataType>
}

export interface Call extends Omit<Untyped.Call, "fn" | "args"> {
  readonly fn: InstanceExpression
  readonly args: Token.Group<"(", InstanceExpression>
  readonly resolved: Typed
}

export interface Chain extends Omit<Untyped.Chain, "statements" | "returns"> {
  readonly statements: (Assign | Call)[]
  readonly returns: InstanceExpression
  readonly resolved: Typed
}

export interface MapConstruct {
  readonly _tag: "MapConstruct"
  readonly type: TypeExpression
  readonly args: Token.Group<
    "{",
    {
      readonly key: InstanceExpression
      readonly colon: Token.Symbol<":">
      readonly value: InstanceExpression
    }
  >
  readonly resolved: Typed<DataType>
}

export interface ListConstruct {
  readonly _tag: "ListConstruct"
  readonly type: TypeExpression
  readonly args: Token.Group<"{", InstanceExpression>
  readonly resolved: Typed<DataType>
}

export interface Construct {
  readonly _tag: "Construct"
  readonly type: TypeExpression
  readonly args: Token.Group<
    "{",
    {
      readonly property?:
        | {
            key: Token.Word
            colon: Token.Symbol<":">
          }
        | undefined
      readonly value: InstanceExpression
    }
  >
  readonly resolved: Typed<DataType>
}

export interface Enum extends Untyped.Enum {
  readonly resolved: DataType
}

export interface FuncDecl extends Omit<Untyped.FuncDecl, "args" | "body"> {
  readonly args: Token.Group<"(", TypeExpression>
  readonly body: TypeExpression
  readonly resolved: FuncType
}

export interface FuncDef extends Omit<
  Untyped.FuncDef,
  "args" | "body" | "returns"
> {
  readonly args: Token.Group<
    "(",
    {
      readonly name: Token.Word
      readonly type: TypeGuard
    }
  >
  readonly returns?: TypeGuard | undefined
  readonly body: InstanceExpression
  readonly resolved: Typed<FuncType>
}

interface FuncDefFirstPass extends Omit<FuncDef, "body" | "resolved"> {
  readonly body: Untyped.Expression
  readonly resolved?: Typed<FuncType> | undefined
}

export interface Generic extends Omit<Untyped.Generic, "body"> {
  readonly body: Expression
  readonly resolved: GenericType
}

export interface IfElse extends Omit<
  Untyped.IfElse,
  "condition" | "ifBranch" | "elseBranch"
> {
  readonly condition: InstanceExpression
  readonly ifBranch: Chain
  readonly elseBranch: IfElse | Chain
  readonly resolved: Typed
}

export interface Literal extends Untyped.Literal {
  readonly resolved: Typed
}

export interface Member extends Omit<Untyped.Member, "object"> {
  readonly object: InstanceExpression
  readonly resolved: Typed<DataType>
}

/**
 * Resolved empty parentheses depends on the context whether the SymbolValue is Typed or Type
 */
export interface MultiParens<
  T extends Typed<DataType> | DataType = Typed<DataType> | DataType
> {
  readonly _tag: "MultiParens"
  readonly group: Token.Group<"(", T extends Typed<DataType> ? InstanceExpression : T extends DataType ? TypeExpression : Expression>
  readonly resolved: T
}

export interface SingleParens<T extends Typed<Type> | Type = Typed<Type> | Type> {
    readonly _tag: "SingleParens"
    readonly open: Token.Symbol<"(">
    readonly expr: T extends Typed<Type> ? InstanceExpression : T extends Type ? TypeExpression : Expression
    readonly close: Token.Symbol<")">
    readonly resolved: T
}

export function isInstanceParens(parens: MultiParens | SingleParens): parens is (MultiParens<Typed<DataType>> | SingleParens<Typed>) {
    return parens.resolved._tag == "Typed"
}

function isTypeParens(parens: MultiParens | SingleParens): parens is (MultiParens<DataType> | SingleParens<Type>) {
  return isType(parens.resolved)
}

export interface Reference<S extends SymbolValue = SymbolValue>
  extends Untyped.Reference {
  readonly resolved: S
}

export function isInstanceReference(ref: Reference): ref is Reference<Typed> {
  return ref.resolved._tag == "Typed"
}

function isTypeReference(ref: Reference): ref is Reference<DataType> {
  return ref.resolved._tag == "DataType"
}

export interface Struct extends Untyped.Struct {
  resolved: DataType
}

export interface TemplateString extends Token.TemplateString<InstanceExpression> {
  resolved: Typed<DataType>
}

export interface UnaryOp extends Omit<Untyped.UnaryOp, "right"> {
  readonly right: InstanceExpression
  readonly resolved: Typed<DataType>
}

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
  | ListConstruct
  | Literal
  | MapConstruct
  | Member
  | MultiParens
  | Reference
  | SingleParens
  | TemplateString
  | UnaryOp

export type InstanceExpression =
  | BinaryOp
  | Call
  | Chain
  | Construct
  | FuncDef
  | IfElse
  | ListConstruct
  | Literal
  | MapConstruct
  | Member
  | MultiParens<Typed<DataType>>
  | Reference<Typed>
  | SingleParens<Typed>
  | TemplateString
  | UnaryOp

export type TypeExpression =
  | Apply
  | FuncDecl
  | MultiParens<DataType>
  | Reference<Type>
  | SingleParens<Type>

type TopAssignRhsFirstPass = Exclude<Expression, FuncDef> | FuncDefFirstPass

export function parseScripts(
  scripts: Source.Source[],
  globals: Scope
): Record<string, Script> {
  return resolveScripts(scripts.map(Untyped.parseScript), globals)
}

/**
 * Simple recursive algorithm
 *
 * TODO: some context for
 * @param script
 */
export function resolveScripts(
  scripts: Untyped.Script[],
  globals: Scope
): Record<string, Script> {
  const map: Record<string, Untyped.Script | Script> = Object.fromEntries(
    scripts.map((s) => [Untyped.scriptName(s), s])
  )

  const resolved: Record<string, Script> = {}

  for (const k in map) {
    const s = map[k]
    if ("resolved" in s) {
      resolved[k] = s
    } else {
      const resolver = new Resolver(globals, map, [], "Any")

      resolved[k] = resolver.resolveScript(s)
      map[k] = resolved[k]
    }
  }

  return resolved
}

export type Scope = Readonly<Record<string, SymbolValue>>

function addToScope(
  scope: Scope,
  name: Token.Word,
  value: SymbolValue,
  allowShadowing: boolean = false
): Scope {
  if (name.value in scope) {
    if (allowShadowing) {
      const prev = scope[name.value]

      if (
        prev._tag == "Typed" &&
        value._tag == "Typed" &&
        prev.type._tag == "DataType" &&
        value.type._tag == "DataType" &&
        prev.type.path == value.type.path
      ) {
        return {
          ...scope,
          [name.value]: value
        }
      }
    }

    throw new CompilerError.Reference(
      name.sourceSpan,
      `'${name.value}' already defined`
    )
  } else {
    return {
      ...scope,
      [name.value]: value
    }
  }
}

class Resolver {
  readonly globals: Scope
  readonly modules: Record<string, Untyped.Script | Script>

  /**
   * The callers are used to detect circular imports
   */
  readonly callers: string[]

  readonly context: "Any" | "Instance" | "Type"

  /**
   * TODO: add global scope as context
   */
  constructor(
    globals: Scope,
    modules: Record<string, Untyped.Script | Script>,
    callers: string[],
    context: "Any" | "Instance" | "Type"
  ) {
    this.globals = globals
    this.modules = modules
    this.callers = callers
    this.context = context
  }

  resolveScript(script: Untyped.Script): Script {
    let scope = this.globals

    const scriptName = Untyped.scriptName(script)

    const firstPass: StatementFirstPass[] = []

    /**
     * In the first pass the FuncDef bodies aren't evaluated, and FuncDef types missing return types aren't added to the scope
     */
    for (const statement of script.statements) {
      switch (statement._tag) {
        case "Comment":
          firstPass.push(statement)
          break
        case "Import":
          {
            const resolvedImport = this.resolveImport(
              statement,
              scope,
              scriptName
            )
            scope = resolvedImport.scope
            firstPass.push(resolvedImport.statement)
          }
          break
        case "Declare":
          {
            const resolvedDeclare = this.resolveDeclare(statement, scope, script.path)
            scope = resolvedDeclare.scope
            firstPass.push(resolvedDeclare.statement)
          }
          break
        case "Assign":
          {
            const resolvedAssign = this.resolveTopAssignFirstPass(
              statement,
              scope,
              script.path
            )
            scope = resolvedAssign.scope
            firstPass.push(resolvedAssign.statement)
          }
          break
      }
    }

    const secondPass: Statement[] = []

    for (const statement of firstPass) {
      switch (statement._tag) {
        case "Comment":
        case "Import":
        case "Declare":
          secondPass.push(statement)
          break
        case "Assign": {
          const resolvedAssign = this.resolveTopAssignSecondPass(
            statement,
            scope
          )
          scope = resolvedAssign.scope
          secondPass.push(resolvedAssign.statement)
          break
        }
      }
    }

    const namespaceScope: Record<string, SymbolValue> = {}

    for (const statement of secondPass) {
      if (statement._tag == "Assign" || statement._tag == "Declare") {
        if (statement.export !== undefined) {
          namespaceScope[statement.name.value] = scope[statement.name.value]
        }
      }
    }

    return {
      ...script,
      statements: secondPass,
      resolved: {
        _tag: "Namespace",
        members: namespaceScope
      }
    }
  }

  private resolveImport(
    untyped: Untyped.Import,
    scope: Scope,
    caller: string
  ): { scope: Scope; statement: Import } {
    const module = this.getResolvedModule(untyped.path, caller)

    const statement: Import = {
      ...untyped,
      namespace: module.resolved
    }

    const alias = statement.path.names[statement.path.names.length - 1]

    scope = addToScope(scope, alias, module.resolved)

    return { scope, statement }
  }

  private resolveDeclare(
    untyped: Untyped.Declare,
    scope: Scope,
    scriptPath: Untyped.Path
  ): { scope: Scope; statement: Declare } {
    const resolvedType = this.resolveTypeGuard(untyped.type, scope)

    const value: SymbolValue = {
      _tag: "Typed",
      type: resolvedType.resolved
    }

    scope = addToScope(scope, untyped.name, value, false)

    return {
      scope,
      statement: {
        ...untyped,
        type: resolvedType,
        path: Untyped.extendPath(scriptPath, untyped.name)
      } satisfies Declare
    }
  }

  private resolveTopAssignFirstPass(
    untyped: Untyped.TopAssign,
    scope: Scope,
    scriptPath: Untyped.Path
  ): { scope: Scope; statement: TopAssignFirstPass } {
    let resolvedAssign: TopAssignFirstPass

    const symbolPath = Untyped.extendPath(scriptPath, untyped.name)
    if (untyped.type !== undefined && untyped.rhs._tag == "FuncDef") {
      const resolvedRhs = this.resolveFuncDefFirstPass(untyped.rhs, scope)
      const resolvedType = this.resolveTypeGuard(untyped.type, scope)

      if (
        resolvedRhs.resolved &&
        !isInstanceOf(resolvedRhs.resolved, resolvedType.resolved)
      ) {
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped.rhs),
          "Unexpected type"
        )
      }

      scope = addToScope(scope, untyped.name, {
        _tag: "Typed",
        type: resolvedType.resolved,
        path: symbolPath
      })

      resolvedAssign = {
        ...untyped,
        type: resolvedType,
        rhs: resolvedRhs,
        path: symbolPath
      }
    } else if (untyped.type !== undefined) {
      const resolvedRhs = this.resolveInstanceExpression(untyped.rhs, scope)
      const resolvedType = this.resolveTypeGuard(untyped.type, scope)

      if (resolvedRhs._tag == "FuncDef") {
        throw new Error(
          "unexpected FuncDef rhs (should've been handled by another branch)"
        )
      }

      if (!isInstanceOf(resolvedRhs.resolved, resolvedType.resolved)) {
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped.rhs),
          "Unexpected type"
        )
      }

      scope = addToScope(scope, untyped.name, {
        _tag: "Typed",
        type: resolvedType.resolved,
        path: symbolPath
      })

      resolvedAssign = {
        ...untyped,
        type: resolvedType,
        rhs: resolvedRhs,
        path: symbolPath
      }
    } else if (untyped.rhs._tag == "FuncDef") {
      const resolvedRhs = this.resolveFuncDefFirstPass(untyped.rhs, scope)

      
      if (resolvedRhs.resolved !== undefined) {
        let symbolValue = resolvedRhs.resolved
        if (symbolValue._tag == "Typed") {
            symbolValue = {
                ...resolvedRhs.resolved,
                path: symbolPath
            }
        }

        addToScope(scope, untyped.name, symbolValue)
      }

      resolvedAssign = {
        ...untyped,
        rhs: resolvedRhs,
        type: undefined,
        path: symbolPath
      }
    } else {
      const resolvedRhs = this.resolveExpression(untyped.rhs, scope)

      if (resolvedRhs._tag == "FuncDef") {
        throw new Error(
          "unexpected FuncDef rhs (should've been handled by another branch)"
        )
      }

      let symbolValue = resolvedRhs.resolved

      if (symbolValue._tag == "Typed") {
        symbolValue = {
            ...symbolValue,
            path: symbolPath
        }
      }

      scope = addToScope(scope, untyped.name, symbolValue)

      resolvedAssign = {
        ...untyped,
        rhs: resolvedRhs,
        type: undefined,
        path: symbolPath
      }
    }

    return {
      scope,
      statement: resolvedAssign
    }
  }

  private resolveTopAssignSecondPass(
    firstPass: TopAssignFirstPass,
    scope: Scope
  ): { scope: Scope; statement: TopAssign } {
    if (firstPass.rhs._tag == "FuncDef") {
      const resolvedRhs = this.resolveFuncDefSecondPass(firstPass.rhs, scope)

      if (firstPass.type?.resolved !== undefined) {
        if (!isInstanceOf(resolvedRhs.resolved, firstPass.type.resolved)) {
          throw new CompilerError.Type(
            Untyped.sourceSpan(firstPass.rhs.body),
            "Unexpected return type"
          )
        }
      } else {
        let symbolValue = resolvedRhs.resolved

        if (symbolValue._tag == "Typed") {
            symbolValue = {
                ...symbolValue,
                path: firstPass.path
            }
        }

        scope = addToScope(scope, firstPass.name, symbolValue, false)
      }

      return {
        scope,
        statement: {
          ...firstPass,
          rhs: resolvedRhs
        }
      }
    } else {
      return {
        scope,
        statement: {
          ...firstPass,
          rhs: firstPass.rhs
        }
      }
    }
  }

  private resolveTypeGuard(
    untyped: Untyped.TypeGuard,
    scope: Scope
  ): TypeGuard {
    const type = this.resolveTypeExpression(untyped.type, scope)

    return {
      ...untyped,
      type,
      resolved: type.resolved
    }
  }

  private resolveExpression(
    expr: Untyped.Expression,
    scope: Scope
  ): Expression {
    switch (expr._tag) {
      case "Apply":
        return this.resolveApply(expr, scope)
      case "BinaryOp":
        return this.resolveBinaryOp(expr, scope)
      case "Call":
        return this.resolveCall(expr, scope)
      case "Chain":
        return this.resolveChain(expr, scope)
      case "Construct":
        return this.resolveConstruct(expr, scope)
      case "FuncDecl":
        return this.resolveFuncDecl(expr, scope)
      case "FuncDef":
        return this.resolveFuncDef(expr, scope)
      case "Generic":
        return this.resolveGeneric(expr, scope)
      case "IfElse":
        return this.resolveIfElse(expr, scope)
      case "Literal":
        return this.resolveLiteral(expr, scope)
      case "Member":
        return this.resolveMember(expr, scope)
      case "Parens":
        return this.resolveParens(expr, scope)
      case "Reference":
        return this.resolveReference(expr, scope)
      case "TemplateString":
        return this.resolveTemplateString(expr, scope)
      case "UnaryOp":
        return this.resolveUnaryOp(expr, scope)
    }
  }

  private resolveApply(untyped: Untyped.Apply, scope: Scope): Apply {
    const gtype = this.resolveExpression(untyped.gtype, scope)

    if (gtype.resolved._tag != "GenericType") {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.gtype),
        "Expected a generic type"
      )
    }

    const args = untyped.args.fields.map((arg) => {
      const resolved = this.resolveTypeExpression(arg, scope)

      return resolved
    })

    if (args.length != gtype.resolved.nArgs) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped),
        `Expected ${gtype.resolved.nArgs} type arguments`
      )
    }

    const dataTypeArgs: DataType[] = args.map((a, i) => {
      if (a.resolved._tag != "DataType") {
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped.args.fields[i]),
          "All apply args must be DataTypes"
        )
      }

      return a.resolved
    })

    return {
      ...untyped,
      gtype,
      args: {
        ...untyped.args,
        fields: args
      },
      resolved: gtype.resolved.type(dataTypeArgs)
    }
  }

  private resolveBinaryOp(untyped: Untyped.BinaryOp, scope: Scope): BinaryOp {
    const left = this.resolveInstanceExpression(untyped.left, scope)
    const right = this.resolveInstanceExpression(untyped.right, scope)

    if (
      !isAssignableTo(left.resolved.type, right.resolved.type) ||
      !isAssignableTo(right.resolved.type, left.resolved.type)
    ) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped),
        "Binary operands must have compatible types"
      )
    }

    if (left.resolved.type._tag != "DataType") {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.left),
        "Expected data type for binary operation"
      )
    }

    return {
      ...untyped,
      left,
      right,
      resolved: {
        _tag: "Typed",
        type: left.resolved.type
      }
    }
  }

  private resolveCall(untyped: Untyped.Call, scope: Scope): Call {
    const fn = this.resolveInstanceExpression(untyped.fn, scope)

    if (fn.resolved.type._tag != "FuncType") {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.fn),
        "Expected function"
      )
    }
    const fnType = fn.resolved.type

    const args = untyped.args.fields.map((arg) =>
      this.resolveInstanceExpression(arg, scope)
    )

    if (args.length != fnType.args.length) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped),
        `Expected ${fnType.args.length} arguments`
      )
    }

    args.forEach((arg, i) => {
      if (!isAssignableTo(arg.resolved.type, fnType.args[i])) {
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped.args.fields[i]),
          "Argument type mismatch"
        )
      }
    })

    return {
      ...untyped,
      fn,
      args: {
        ...untyped.args,
        fields: args
      },
      resolved: {
        _tag: "Typed",
        type: fnType.returns
      }
    }
  }

  private resolveChain(untyped: Untyped.Chain, scope: Scope): Chain {
    const statements: (Assign | Call)[] = []

    for (const statement of untyped.statements) {
      if (statement._tag == "Call") {
        const resolvedCall = this.resolveCall(statement, scope)

        if (!isUnitType(resolvedCall.resolved.type)) {
          throw new CompilerError.Type(
            Untyped.sourceSpan(statement),
            "Expected Unit return type for chain statement call"
          )
        }

        statements.push(resolvedCall)
      } else {
        let resolvedType: TypeGuard | undefined
        if (statement.type !== undefined) {
          resolvedType = this.resolveTypeGuard(statement.type, scope)
        }

        const resolvedRhs = this.resolveInstanceExpression(statement.rhs, scope)

        if (
          resolvedType !== undefined &&
          !isInstanceOf(resolvedRhs.resolved, resolvedType.resolved)
        ) {
          throw new CompilerError.Type(
            Untyped.sourceSpan(statement.rhs),
            "Unexpected type"
          )
        }

        scope = addToScope(scope, statement.name, resolvedRhs.resolved, false)

        const resolvedAssign: Assign = {
          _tag: "Assign",
          name: statement.name,
          equals: statement.equals,
          rhs: resolvedRhs,
          ...(resolvedType === undefined ? {} : { type: resolvedType })
        }

        statements.push(resolvedAssign)
      }
    }

    const returns = this.resolveInstanceExpression(untyped.returns, scope)

    return {
      ...untyped,
      statements,
      returns,
      resolved: returns.resolved
    }
  }

  private resolveConstruct(
    untyped: Untyped.Construct,
    scope: Scope
  ): Construct | ListConstruct | MapConstruct {
    const resolvedTypeExpr = this.resolveTypeExpression(untyped.type, scope)
    const type = resolvedTypeExpr.resolved

    if (isListType(type)) {
      const args: InstanceExpression[] = []

      for (const f of untyped.args.fields) {
        if (f.property !== undefined) {
          throw new CompilerError.Type(
            Untyped.sourceSpan(untyped),
            "Unexpected property name for list constructor"
          )
        }

        args.push(this.resolveInstanceExpression(f.value, scope))
      }

      return {
        _tag: "ListConstruct",
        type: resolvedTypeExpr,
        args: {
          ...untyped.args,
          fields: args
        },
        resolved: {
          _tag: "Typed",
          type: type
        }
      }
    } else if (isMapType(type)) {
      const args: {
        key: InstanceExpression
        colon: Token.Symbol<":">
        value: InstanceExpression
      }[] = []

      for (const field of untyped.args.fields) {
        if (field.property === undefined) {
          throw new CompilerError.Type(
            Untyped.sourceSpan(field.value),
            "Missing key expression"
          )
        }

        const key = this.resolveInstanceExpression(field.property.key, scope)
        const colon = field.property.colon
        const value = this.resolveInstanceExpression(field.value, scope)

        args.push({
          key,
          colon,
          value
        })
      }

      return {
        _tag: "MapConstruct",
        type: resolvedTypeExpr,
        args: {
          ...untyped.args,
          fields: args
        },
        resolved: {
          _tag: "Typed",
          type: type
        }
      }
    } else if (isDataType(type)) {
      const args = untyped.args.fields.map((f) => {
        const resolvedValue = this.resolveInstanceExpression(f.value, scope)

        if (f.property === undefined) {
          return { value: resolvedValue }
        } else {
          if (
            f.property.key._tag != "Reference" ||
            f.property.key.path.names.length != 1
          ) {
            throw new CompilerError.Syntax(
              Untyped.sourceSpan(f.property.key),
              "Expected word, got expression"
            )
          }

          return {
            property: {
              key: f.property.key.path.names[0],
              colon: f.property.colon
            },
            value: resolvedValue
          }
        }
      })

      return {
        _tag: "Construct",
        type: resolvedTypeExpr,
        args: {
          ...untyped.args,
          fields: args
        },
        resolved: {
          _tag: "Typed",
          type: type
        }
      }
    } else {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.type),
        "Expected data type constructor"
      )
    }
  }

  private resolveFuncDecl(untyped: Untyped.FuncDecl, scope: Scope): FuncDecl {
    const args = untyped.args.fields.map((arg) =>
      this.resolveTypeExpression(arg, scope)
    )

    const body = this.resolveTypeExpression(untyped.body, scope)

    return {
      ...untyped,
      args: {
        ...untyped.args,
        fields: args
      },
      body,
      resolved: {
        _tag: "FuncType",
        args: args.map((a) => a.resolved),
        returns: body.resolved
      }
    }
  }

  private resolveFuncDef(untyped: Untyped.FuncDef, scope: Scope): FuncDef {
    const args = untyped.args.fields.map((arg) => {
      const type = this.resolveTypeGuard(arg.type, scope)
      return {
        ...arg,
        type
      }
    })

    let bodyScope = scope
    for (const arg of args) {
      bodyScope = addToScope(
        bodyScope,
        arg.name,
        {
          _tag: "Typed",
          type: arg.type.resolved
        },
        true
      )
    }

    const resolvedReturns =
      untyped.returns === undefined
        ? undefined
        : this.resolveTypeGuard(untyped.returns, scope)

    const body = this.resolveInstanceExpression(untyped.body, bodyScope)

    if (
      resolvedReturns !== undefined &&
      !isInstanceOf(body.resolved, resolvedReturns.resolved)
    ) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.body),
        "Unexpected body return type"
      )
    }

    return {
      _tag: "FuncDef",
      args: {
        ...untyped.args,
        fields: args
      },
      arrow: untyped.arrow,
      ...(resolvedReturns === undefined ? {} : { returns: resolvedReturns }),
      body,
      resolved: {
        _tag: "Typed",
        type: {
          _tag: "FuncType",
          args: args.map((a) => a.type.resolved),
          returns: resolvedReturns?.resolved ?? body.resolved.type
        }
      }
    }
  }

  private resolveGeneric(untyped: Untyped.Generic, scope: Scope): Generic {
    let genericScope = scope

    for (const arg of untyped.args.fields) {
      genericScope = addToScope(
        genericScope,
        arg,
        {
          _tag: "DataType",
          path: {
            _tag: "Path",
            names: [arg],
            separators: []
          },
          properties: {},
          variants: {}
        },
        false
      )
    }

    const body = this.resolveTypeExpression(untyped.body, genericScope)
    const nArgs = untyped.args.fields.length

    return {
      ...untyped,
      body,
      resolved: {
        _tag: "GenericType",
        nArgs: untyped.args.fields.length,
        type: (args: DataType[]) => {
          // re-evaluate the body with proper types?
          for (let i = 0; i < nArgs; i++) {
            scope = addToScope(scope, untyped.args.fields[i], args[i], false)
          }

          const nonGenericBody = this.resolveTypeExpression(untyped.body, scope)

          if (nonGenericBody.resolved._tag == "DataType") {
            return {
              ...nonGenericBody.resolved,
              path: {
                ...nonGenericBody.resolved.path,
                appliedTypes: args
              }
            }
          } else {
            // TODO: should applied generic FuncType also reference the types that were applied to it?
            return nonGenericBody.resolved
          }
        }
      }
    }
  }

  private resolveIfElse(untyped: Untyped.IfElse, scope: Scope): IfElse {
    const condition = this.resolveInstanceExpression(untyped.condition, scope)

    if (!isBool(condition.resolved)) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.condition),
        "Expected Bool condition"
      )
    }

    const ifBranch = this.resolveChain(untyped.ifBranch, scope)
    const elseBranch =
      untyped.elseBranch._tag == "IfElse"
        ? this.resolveIfElse(untyped.elseBranch, scope)
        : this.resolveChain(untyped.elseBranch, scope)

    if (
      !isAssignableTo(ifBranch.resolved.type, elseBranch.resolved.type) ||
      !isAssignableTo(elseBranch.resolved.type, ifBranch.resolved.type)
    ) {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped),
        "If/else branches must return compatible types"
      )
    }

    return {
      ...untyped,
      condition,
      ifBranch,
      elseBranch,
      resolved: ifBranch.resolved
    }
  }

  private resolveLiteral(untyped: Untyped.Literal, scope: Scope): Literal {
    switch (untyped.value._tag) {
      case "Bool":
        return {
          ...untyped,
          resolved: {
            _tag: "Typed",
            type: scope["Bool"] as DataType
          }
        }
      case "Bytes":
        return {
          ...untyped,
          resolved: {
            _tag: "Typed",
            type: scope["ByteArray"] as DataType
          }
        }
      case "Int":
        return {
          ...untyped,
          resolved: {
            _tag: "Typed",
            type: scope["Int"] as DataType
          }
        }
      case "PlainString":
        return {
          ...untyped,
          resolved: {
            _tag: "Typed",
            type: scope["String"] as DataType
          }
        }
      case "Real":
        return {
          ...untyped,
          resolved: {
            _tag: "Typed",
            type: scope["Real"] as DataType
          }
        }
    }
  }

  private resolveMember(untyped: Untyped.Member, scope: Scope): Member {
    const object = this.resolveInstanceExpression(untyped.object, scope)

    if (object.resolved.type._tag != "DataType") {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.object),
        "Expected data type with members"
      )
    }

    const memberType =
      object.resolved.type.properties[untyped.member.value] ??
      object.resolved.type.variants[untyped.member.value]

    if (memberType === undefined) {
      throw new CompilerError.Reference(
        untyped.member.sourceSpan,
        `Unknown member '${untyped.member.value}'`
      )
    }

    return {
      ...untyped,
      object,
      resolved: {
        _tag: "Typed",
        type: memberType
      }
    }
  }

  private resolveParens(untyped: Untyped.Parens, scope: Scope): MultiParens | SingleParens {
    if (this.context == "Instance") {
        const fields = untyped.group.fields.map((field) => 
            this.resolveInstanceExpression(field, scope)
        )

        if (fields.length == 0) {
            return {
                _tag: "MultiParens",
                group: {
                    ...untyped.group,
                    fields
                },
                resolved: {
                    _tag: "Typed",
                    type: {
                        _tag: "DataType",
                        path: {
                          _tag: "Path",
                          names: [{
                            _tag: "Word",
                            value: "Unit",
                            sourceSpan: Source.mergeSpan(untyped.group.open.sourceSpan, untyped.group.close.sourceSpan)
                          }],
                          separators: []
                        },
                        properties: {},
                        variants: {}
                    }
                }
            }
        } else if (fields.length == 1) {
            return {
                _tag: "SingleParens",
                open: untyped.group.open,
                close: untyped.group.close,
                expr: fields[0],
                resolved: fields[0].resolved
            }
        } else {
            const dataFields: Typed<DataType>[] = fields.map((f, i) => {
                if (f.resolved._tag == "Typed" && isDataType(f.resolved.type)) {
                    return f.resolved as Typed<DataType>
                } else {
                    throw new CompilerError.Type(
                        Untyped.sourceSpan(untyped),
                        "Tuple expressions must be all data instances in this context"
                    )
                }
            })

            return {
                _tag: "MultiParens",
                group: {
                    ...untyped.group,
                    fields
                },
                resolved: {
                    _tag: "Typed",
                    type: {
                        _tag: "DataType",
                        path: {
                          _tag: "Path",
                          names: [{
                            _tag: "Word",
                            value: "Tuple",
                            sourceSpan: Source.mergeSpan(untyped.group.open.sourceSpan, untyped.group.close.sourceSpan),
                          }],
                          separators: [],
                          appliedTypes: dataFields.map(d => d.type)

                        },
                        properties: {},
                        variants: {}
                    }
                }
            }
        }
    } else if (this.context == "Type") {
        const fields = untyped.group.fields.map((field) => 
            this.resolveTypeExpression(field, scope)
        )

        if (fields.length == 0) {
            return {
                _tag: "MultiParens",
                group: {
                    ...untyped.group,
                    fields
                },
                resolved: {
                    _tag: "DataType",
                    path: {
                          _tag: "Path",
                          names: [{
                            _tag: "Word",
                            value: "Unit",
                            sourceSpan: Source.mergeSpan(untyped.group.open.sourceSpan, untyped.group.close.sourceSpan)
                          }],
                          separators: []
                        },
                    properties: {},
                    variants: {}
                }
            }
        } else if (fields.length == 1) {
            return {
                _tag: "SingleParens",
                open: untyped.group.open,
                close: untyped.group.close,
                expr: fields[0],
                resolved: fields[0].resolved
            }
        } else {
            const dataFields = fields.map((f, i) => {
                if (isDataType(f.resolved)) {
                    return f.resolved
                } else {
                    throw new CompilerError.Type(
                        Untyped.sourceSpan(untyped),
                        "Tuple expressions must be all data types in this context"
                    )
                }
            })

            return {
                _tag: "MultiParens",
                group: {
                    ...untyped.group,
                    fields
                },
                resolved: {
                    _tag: "DataType",
                    path: {
                          _tag: "Path",
                          names: [{
                            _tag: "Word",
                            value: "Tuple",
                            sourceSpan: Source.mergeSpan(untyped.group.open.sourceSpan, untyped.group.close.sourceSpan),
                          }],
                          separators: [],
                          appliedTypes: dataFields

                        },
                    properties: {},
                    variants: {}
                }
            }
        }
    } else {
        throw new Error("resolveParens() requires context to by Instance or Type")
    }
    

    
  }

  private resolveReference(
    untyped: Untyped.Reference,
    scope: Scope
  ): Reference {
    const [first, ...rest] = untyped.path.names
    let current: SymbolValue | undefined = scope[first.value]

    if (current === undefined) {
      throw new CompilerError.Reference(
        first.sourceSpan,
        `'${first.value}' not found`
      )
    }

    for (const segment of rest) {
      if (current._tag != "Namespace") {
        throw new CompilerError.Type(
          segment.sourceSpan,
          `Expected namespace before '${segment.value}'`
        )
      }

      current = current.members[segment.value]
      if (current === undefined) {
        throw new CompilerError.Reference(
          segment.sourceSpan,
          `'${segment.value}' not found`
        )
      }
    }

    return {
      ...untyped,
      resolved: current
    }
  }

  private resolveTemplateString(
    untyped: Untyped.TemplateString,
    scope: Scope
  ): TemplateString {
    const tokens = untyped.tokens.map((token) =>
      this.resolveInstanceExpression(token, scope)
    )

    return {
      ...untyped,
      tokens,
      resolved: {
        _tag: "Typed",
        type: scope["String"] as DataType
      }
    }
  }

  private resolveUnaryOp(untyped: Untyped.UnaryOp, scope: Scope): UnaryOp {
    const right = this.resolveInstanceExpression(untyped.right, scope)

    if (right.resolved.type._tag != "DataType") {
      throw new CompilerError.Type(
        Untyped.sourceSpan(untyped.right),
        "Expected data type for unary operation"
      )
    }

    return {
      ...untyped,
      right,
      resolved: {
        _tag: "Typed",
        type: right.resolved.type
      }
    }
  }

  private resolveInstanceExpression(
    untyped: Untyped.Expression,
    scope: Scope
  ): InstanceExpression {
    const resolver = new Resolver(
      this.globals,
      this.modules,
      this.callers,
      "Instance"
    )

    const expr = resolver.resolveExpression(untyped, scope)

    switch (expr._tag) {
      case "Generic":
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped),
          "Expected Instance, got Generic"
        )
      case "Apply":
      case "FuncDecl":
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped),
          "Expected Instance, got Type"
        )
      case "BinaryOp":
      case "Call":
      case "Chain":
      case "Construct":
      case "FuncDef":
      case "IfElse":
      case "ListConstruct":
      case "Literal":
      case "MapConstruct":
      case "Member":
      case "TemplateString":
      case "UnaryOp":
        return expr
    case "MultiParens":
      case "SingleParens":
        if (isInstanceParens(expr)) {
          return expr
        } else {
          throw new CompilerError.Type(
            Untyped.sourceSpan(untyped),
            "Expected Instance, got Type"
          )
        }
      case "Reference":
        if (isInstanceReference(expr)) {
          return expr
        } else {
          throw new CompilerError.Type(
            Untyped.sourceSpan(untyped),
            "Expected Instance, got Type"
          )
        }
    }
  }

  private resolveTypeExpression(
    untyped: Untyped.Expression,
    scope: Scope
  ): TypeExpression {
    const resolver = new Resolver(
      this.globals,
      this.modules,
      this.callers,
      "Type"
    )

    const expr = resolver.resolveExpression(untyped, scope)

    switch (expr._tag) {
      case "Generic":
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped),
          "Expected Type, got Generic"
        )
      case "Apply":
      case "FuncDecl":
        return expr
      case "BinaryOp":
      case "Call":
      case "Chain":
      case "Construct":
      case "FuncDef":
      case "IfElse":
      case "ListConstruct":
      case "Literal":
      case "MapConstruct":
      case "Member":
      case "TemplateString":
      case "UnaryOp":
        throw new CompilerError.Type(
          Untyped.sourceSpan(untyped),
          "Expected Type, got Instance"
        )
      case "MultiParens":
      case "SingleParens":
        if (isTypeParens(expr)) {
          return expr
        } else {
          throw new CompilerError.Type(
            Untyped.sourceSpan(untyped),
            "Expected Type, got Instance"
          )
        }
      case "Reference":
        if (isTypeReference(expr)) {
          return expr
        } else {
          throw new CompilerError.Type(
            Untyped.sourceSpan(untyped),
            "Expected Type, got Instance"
          )
        }
    }
  }

  private resolveFuncDefFirstPass(
    funcDef: Untyped.FuncDef,
    scope: Scope
  ): FuncDefFirstPass {
    const resolvedArgs = funcDef.args.fields.map(
      (arg): { name: Token.Word; type: TypeGuard } => {
        const resolvedTypeGuard = this.resolveTypeGuard(arg.type, scope)
        return { ...arg, type: resolvedTypeGuard }
      }
    )

    if (funcDef.returns === undefined) {
      return {
        ...funcDef,
        args: {
          ...funcDef.args,
          fields: resolvedArgs
        },
        returns: undefined,
        resolved: undefined
      }
    }

    const resolvedReturns = this.resolveTypeGuard(funcDef.returns, scope)

    return {
      ...funcDef,
      args: {
        ...funcDef.args,
        fields: resolvedArgs
      },
      returns: resolvedReturns,
      resolved: {
        _tag: "Typed",
        type: {
          _tag: "FuncType",
          args: resolvedArgs.map((a) => a.type.resolved),
          returns: resolvedReturns.resolved
        }
      }
    }
  }

  private resolveFuncDefSecondPass(
    funcDef: FuncDefFirstPass,
    scope: Scope
  ): FuncDef {
    for (const arg of funcDef.args.fields) {
      scope = addToScope(
        scope,
        arg.name,
        { _tag: "Typed", type: arg.type.resolved },
        true
      )
    }

    const resolvedBody = this.resolveInstanceExpression(funcDef.body, scope)

    if (funcDef.returns !== undefined) {
      if (!isInstanceOf(resolvedBody.resolved, funcDef.returns.resolved)) {
        throw new CompilerError.Type(
          Untyped.sourceSpan(funcDef.body),
          "Unexpected body return type"
        )
      }
    }

    return {
      ...funcDef,
      body: resolvedBody,
      resolved: funcDef.resolved ?? {
        _tag: "Typed",
        type: {
          _tag: "FuncType",
          args: funcDef.args.fields.map((a) => a.type.resolved),
          returns: resolvedBody.resolved.type
        }
      }
    }
  }

  private getResolvedModule(modulePath: Untyped.Path, caller: string): Script {
    const key = Untyped.pathToString(modulePath)

    if (!(key in this.modules)) {
      throw new CompilerError.Reference(
        Untyped.sourceSpan(modulePath),
        `Module '${key}' not found`
      )
    }

    const module = this.modules[key]

    if ("resolved" in module) {
      return module
    }

    if (this.callers.some((c) => c == key)) {
      throw new CompilerError.Reference(
        Untyped.sourceSpan(modulePath),
        `Circular import detected: ${this.callers.join(" -> ")} -> ${caller}`
      )
    }

    const resolver = new Resolver(
      this.globals,
      this.modules,
      [...this.callers, caller],
      "Any"
    )

    const resolvedModule = resolver.resolveScript(module)

    this.modules[key] = resolvedModule

    return resolvedModule
  }
}
