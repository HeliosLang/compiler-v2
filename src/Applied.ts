import * as Source from "./Source.js"
import * as IR from "./IR.js"
import * as Token from "./Token.js"
import * as Typed from "./Typed.js"
import * as Untyped from "./Untyped.js"

/**
 * After the Typas AST is created, an AST must be generated for each entrypoint.
 *   - generics must be applied (none of the entrypoints can be generic themselves)
 *   - declarations must be substituted or turned into positional outer parameters
 *   - flatten modules/imports
 *   - unused top-level symbols are pruned
 *   - mutual recursion is resolved
 *   - TypeGuards no longer serve a purpose and are removed
 */

export interface Path extends Typed.Path {
  /**
   * Used to target internal auto-generated type methods
   */
  readonly component?: string | undefined
}

function pathToString(path: Path): string {
  return `${Typed.pathToString(path)}${path.component !== undefined && path.component !== "" ? `:::${path.component}` : ""}`
}

function pathScriptName(path: Path): string {
  if (path.names.length < 2) {
    throw new Error(
      `expected 2 path elements to be able to extract script name, got ${path.names.map(n => n.value).join("::")}`
    )
  }

  return path.names
    .slice(0, -1)
    .map((n) => n.value)
    .join("::")
}

function pathSymbolName(path: Path): string {
  const last = path.names.slice().pop()

  if (last === undefined) {
    throw new Error("invalid path")
  }

  return last.value
}

function uniquePaths(...paths: Path[]): Path[] {
  const m = new Map<string, Path>()

  paths.forEach((p) => m.set(pathToString(p), p))

  return Array.from(m.values())
}

export interface EntryPoint {
  readonly _tag: "EntryPoint"

  /**
   * Positional parameters
   */
  readonly parameters: Typed.Declare[]

  /**
   * Builtin and user and definitions
   */
  readonly definitions: Definition[]

  /**
   * For validators this will be a call of a FuncDef with a redeemer
   */
  readonly body: Expression
}

export interface Assign extends Omit<Typed.Assign, "rhs" | "type"> {
  readonly rhs: Expression
}

/**
 * Similar to assign, but there are many internal definitions for which the `name` and `equals` properties don't make any sense
 */
export interface Definition {
  readonly _tag: "Definition"
  readonly expr: Expression
  readonly path: Path
  readonly dependencies?: Path[] | undefined
}

export interface BinaryOp extends Omit<Typed.BinaryOp, "left" | "right"> {
  readonly left: Expression
  readonly right: Expression
}

export interface Call extends Omit<Typed.Call, "fn" | "args"> {
  readonly fn: Expression
  readonly args: Token.Group<"(", Expression>
}

export interface Chain extends Omit<Typed.Chain, "statements" | "returns"> {
  readonly statements: (Assign | Call)[]
  readonly returns: Expression
}

export interface MapConstruct extends Omit<
  Typed.MapConstruct,
  "type" | "args"
> {
  readonly args: Token.Group<
    "{",
    {
      readonly key: Expression
      readonly colon: Token.Symbol<":">
      readonly value: Expression
    }
  >
}

export interface ListConstruct extends Omit<
  Typed.ListConstruct,
  "type" | "args"
> {
  readonly args: Token.Group<"{", Expression>
}

export interface Construct extends Omit<Typed.Construct, "type" | "args"> {
  readonly args: Token.Group<
    "{",
    {
      readonly property?:
        | {
            key: Token.Word
            colon: Token.Symbol<":">
          }
        | undefined
      readonly value: Expression
    }
  >
}

export interface FuncDef extends Omit<
  Typed.FuncDef,
  "args" | "returns" | "body"
> {
  readonly args: Token.Group<"(", Token.Word>
  readonly body: Expression
}

export interface IfElse extends Omit<
  Typed.IfElse,
  "condition" | "ifBranch" | "elseBranch"
> {
  readonly condition: Expression
  readonly ifBranch: Chain
  readonly elseBranch: IfElse | Chain
}

export type Literal = Typed.Literal

export interface Member extends Omit<Typed.Member, "object"> {
  readonly object: Expression
}

export interface MultiParens extends Omit<
  Typed.MultiParens<Typed.Typed<Typed.DataType>>,
  "group"
> {
  readonly group: Token.Group<"(", Expression>
}

export interface SingleParens extends Omit<
  Typed.SingleParens<Typed.Typed>,
  "expr"
> {
  readonly expr: Expression
}

/**
 * Used in next step of compiler pipeline, but defined here so that InstanceExpression can be reused
 */
export interface Raw {
  readonly _tag: "Raw"
  readonly resolved: Typed.Typed
  readonly ir: string
  readonly dependencies: Path[]
}

export interface Reference extends Omit<Typed.Reference<Typed.Typed>, "path"> {
  readonly path: Path

  /**
   * Used for mutual dependencies
   */
  readonly dependencies?: Path[] | undefined
}

export interface TemplateString extends Omit<Typed.TemplateString, "tokens"> {
  readonly tokens: Expression[]
}

export interface UnaryOp extends Omit<Typed.UnaryOp, "right"> {
  readonly right: Expression
}

/**
 * All these expressions map directly to some in the IR/UPLC
 */
export type Expression =
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
  | MultiParens
  | Raw
  | Reference
  | SingleParens
  | TemplateString
  | UnaryOp

export type BuildOptions = {
  compileFunctions?: boolean | undefined
  builtins?: Readonly<Record<string, Raw | undefined>> | undefined
  positionalParams?: readonly string[] | undefined
  substituteParams?: Readonly<Record<string, Raw>> | undefined
}

export type Globals = Record<
  string,
  {
    symbolValue: Typed.SymbolValue
    implementation?: { ir: string; deps: Path[] }
  }
>

export function makeBuiltins(globals: Globals): Record<string, Raw | undefined> {
  const builtins: Record<string, Raw | undefined> = {}

  for (const k in globals) {
    const v = globals[k]

    if (v.symbolValue._tag == "Typed") {
      if (v.implementation) {
      builtins[k] = {
        _tag: "Raw",
        ir: v.implementation.ir,
        dependencies: v.implementation.deps,
        resolved: v.symbolValue
      }
    } else {
      /**
       * A core or globally available symbol, that doesn't requiring a Raw expression
       */
      builtins[k] = undefined
    }
    }
    
  }

  return builtins
}

export function parseEntryPoints(
  srcs: Source.Source[],
  options: {
    compileFunctions?: boolean | undefined
    globals: Globals
    positionalParams?: readonly string[]
    substituteParams?: Readonly<Record<string, Raw>> | undefined // TODO: prefer UplcData as input instead, and convert to Raw internally
  }
): Record<string, EntryPoint> {
  const scripts = Typed.parseScripts(
    srcs,
    Object.fromEntries(
      Object.entries(options.globals ?? {}).map(([k, v]) => [k, v.symbolValue])
    )
  )

  const builtins = makeBuiltins(options.globals ?? {})

  return buildEntryPoints(scripts, {
    builtins,
    positionalParams: options.positionalParams,
    substituteParams: options.substituteParams,
    compileFunctions: options.compileFunctions
  })
}

export function buildEntryPoints(
  scripts: Readonly<Record<string, Typed.Script>>,
  {
    builtins = {},
    positionalParams = [],
    substituteParams = {},
    compileFunctions = false
  }: BuildOptions
): Record<string, EntryPoint> {
  const result: Record<string, EntryPoint> = {}

  const applier = new Applier(
    builtins,
    scripts,
    positionalParams,
    substituteParams
  )

  for (const script of Object.values(scripts)) {
    for (const statement of script.statements) {
      if (statement._tag != "Assign" || statement.export === undefined) {
        continue
      }

      if (script.kind.value == "validator" && statement.name.value == "main") {
        const symbolPath = Untyped.extendPath(script.path, statement.name)

        result[pathToString(symbolPath)] = applier.applyEntryPoint(symbolPath)
      } else if (compileFunctions && statement.rhs._tag == "FuncDef") {
        const symbolPath = Untyped.extendPath(script.path, statement.name)

        result[pathToString(symbolPath)] = applier.applyEntryPoint(symbolPath)
      }
    }
  }

  return result
}

class Applier {
  readonly builtins: Readonly<Record<string, Raw | undefined>>
  readonly scripts: Readonly<Record<string, Typed.Script>>
  readonly positionalParams: readonly string[]
  readonly substituteParams: Readonly<Record<string, Raw>>

  constructor(
    builtins: Readonly<Record<string, Raw | undefined>>,
    scripts: Readonly<Record<string, Typed.Script>>,
    positionalParams: readonly string[],
    substituteParams: Readonly<Record<string, Raw>>
  ) {
    this.builtins = builtins
    this.scripts = scripts
    this.positionalParams = positionalParams
    this.substituteParams = substituteParams

    for (const path of this.positionalParams) {
      this.findParameterDeclaration(path)

      if (path in this.substituteParams) {
        throw new Error(
          `parameter ${path} can't be both positional and substituted`
        )
      }
    }

    for (const path in this.substituteParams) {
      this.findParameterDeclaration(path)

      if (this.positionalParams.includes(path)) {
        throw new Error(
          `parameter ${path} can't be both substituted and positional`
        )
      }
    }
  }

  applyEntryPoint(entryPointPath: Typed.Path): EntryPoint {
    const graph = this.createDefinitionGraph(entryPointPath)

    let definitions = this.orderDefinitions(graph)

    const entryPointDef = definitions.find(
      (d) => pathToString(d.path) == pathToString(entryPointPath)
    )

    if (!entryPointDef) {
      throw new Error("unexpected")
    }

    definitions = definitions.filter(
      (d) => pathToString(d.path) == pathToString(entryPointPath)
    )

    return {
      _tag: "EntryPoint",
      parameters: this.positionalParams.map((pp) =>
        this.findParameterDeclaration(pp)
      ),
      definitions,
      body: entryPointDef.expr
    }
  }

  private orderDefinitions(
    graph: Readonly<Record<string, Definition>>
  ): Definition[] {
    const definitions: Definition[] = []
    const done = new Set<string>()

    while (done.size < Object.keys(graph).length) {
      let picked: Definition[] = []
      let pickedNonDoneDeps = new Set<string>()

      for (const k in graph) {
        if (done.has(k)) {
          continue
        }

        const def = graph[k]

        const nonDoneDeps = new Set(
          (def.dependencies ?? []).map(pathToString).filter((depKey) => {
            return depKey in graph && !done.has(depKey)
          })
        )

        if (picked.length == 0) {
          picked = [def]
          pickedNonDoneDeps = nonDoneDeps
        } else if (nonDoneDeps.size < pickedNonDoneDeps.size) {
          picked = [def]
          pickedNonDoneDeps = nonDoneDeps
        } else if (
          nonDoneDeps.size == pickedNonDoneDeps.size &&
          nonDoneDeps.difference(pickedNonDoneDeps).size == 0
        ) {
          picked.push(def)
        }
      }

      if (picked.length == 0) {
        break
      } else {
        // the first definition in the mutually dependent group determines the order of the deps
        const deps = (picked[0].dependencies ?? []).filter((d) =>
          pickedNonDoneDeps.has(pathToString(d))
        )

        for (const def of picked) {
          const expr =
            deps.length > 0
              ? applyMutualDependenciesToReferences(def.expr, deps)
              : def.expr

          definitions.push({
            ...def,
            expr,
            dependencies: deps
          })

          done.add(pathToString(def.path))
        }
      }
    }

    return definitions
  }

  private createDefinitionGraph(
    entryPointPath: Typed.Path
  ): Readonly<Record<string, Definition>> {
    const entryPoint = this.findInstanceExpression(entryPointPath)

    if (entryPoint === undefined) {
      throw new Error(`Entrypoint ${pathToString(entryPointPath)} not found`)
    }

    /**
     * The string key is the stringified path of the Definition
     */
    const definitions: Record<string, Definition> = {}

    const stack: { path: Path; expr: Typed.InstanceExpression | Raw }[] = [
      { path: entryPointPath, expr: entryPoint }
    ]
    let head = stack.pop()

    while (head !== undefined) {
      const headPathStr = pathToString(head.path)
      if (!(headPathStr in definitions)) {
        const { applied, dependencies } = this.applyExpression(head.expr)

        definitions[headPathStr] = {
          _tag: "Definition",
          expr: applied,
          dependencies,
          path: head.path
        }

        for (const dep of dependencies) {
          if (pathToString(dep) in definitions) {
            continue
          }

          const depExpr = this.findInstanceExpression(dep)

          if (depExpr !== undefined) {
            stack.push({
              path: dep,
              expr: depExpr
            })
          }
        }
      }

      head = stack.pop()
    }

    return definitions
  }

  /**
   * Walk the typed Expression,
   * @param expr
   */
  private applyExpression(expr: Typed.InstanceExpression | Raw): {
    applied: Expression
    dependencies: Path[]
  } {
    switch (expr._tag) {
      case "BinaryOp": {
        const left = this.applyExpression(expr.left)
        const right = this.applyExpression(expr.right)

        return {
          applied: {
            ...expr,
            left: left.applied,
            right: right.applied
          },
          dependencies: uniquePaths(...left.dependencies, ...right.dependencies)
        }
      }
      case "Call":
        return this.applyCall(expr)
      case "Chain":
        return this.applyChain(expr)
      case "Construct": {
        const args = expr.args.fields.map((a) => this.applyExpression(a.value))

        // putting args in correct order is done in codegeneration step
        return {
          applied: {
            _tag: "Construct",
            args: {
              ...expr.args,
              fields: expr.args.fields.map((f, i) => ({
                ...f,
                value: args[i].applied
              }))
            },
            resolved: expr.resolved
          },
          dependencies: uniquePaths(
            expr.resolved.type.path,
            ...args.map((a) => a.dependencies).flat()
          )
        }
      }
      case "FuncDef":
        return this.applyFuncDef(expr)
      case "IfElse":
        return this.applyIfElse(expr)
      case "ListConstruct": {
        const args = expr.args.fields.map((a) => this.applyExpression(a))

        return {
          applied: {
            _tag: "ListConstruct",
            args: {
              ...expr.args,
              fields: args.map((a) => a.applied)
            },
            resolved: expr.resolved
          },
          dependencies: uniquePaths(
            expr.resolved.type.path,
            ...args.map((a) => a.dependencies).flat()
          )
        }
      }
      case "Literal":
        return { applied: expr, dependencies: [] }
      case "MapConstruct": {
        const args = expr.args.fields.map((f) => ({
          key: this.applyExpression(f.key),
          colon: f.colon,
          value: this.applyExpression(f.value)
        }))

        return {
          applied: {
            _tag: "MapConstruct",
            args: {
              ...expr.args,
              fields: args.map((a) => ({
                key: a.key.applied,
                colon: a.colon,
                value: a.value.applied
              }))
            },
            resolved: expr.resolved
          },
          dependencies: uniquePaths(
            expr.resolved.type.path,
            ...args.flatMap((a) => [
              ...a.key.dependencies,
              ...a.value.dependencies
            ])
          )
        }
      }
      case "Member": {
        const object = this.applyExpression(expr.object)

        return {
          applied: {
            ...expr,
            object: object.applied
          },
          dependencies: object.dependencies
        }
      }
      case "MultiParens": {
        const args = expr.group.fields.map((a) => this.applyExpression(a))

        return {
          applied: {
            ...expr,
            group: {
              ...expr.group,
              fields: args.map((a) => a.applied)
            }
          },
          dependencies: uniquePaths(...args.map((a) => a.dependencies).flat())
        }
      }
      case "Raw":
        return {
          applied: expr,
          dependencies: expr.dependencies
        }
      case "Reference":
        return {
          applied: expr,
          dependencies:
            expr.resolved.path
              ? [expr.resolved.path]
              : []
        }
      case "SingleParens": {
        const arg = this.applyExpression(expr.expr)

        return {
          applied: {
            ...expr,
            expr: arg.applied
          },
          dependencies: arg.dependencies
        }
      }
      case "TemplateString": {
        const tokens = expr.tokens.map((t) => this.applyExpression(t))

        return {
          applied: {
            ...expr,
            tokens: tokens.map((t) => t.applied)
          },
          dependencies: uniquePaths(...tokens.flatMap((t) => t.dependencies))
        }
      }
      case "UnaryOp": {
        const right = this.applyExpression(expr.right)

        return {
          applied: {
            ...expr,
            right: right.applied
          },
          dependencies: right.dependencies
        }
      }
    }
  }

  private applyCall(expr: Typed.Call): { applied: Call; dependencies: Path[] } {
    const fn = this.applyExpression(expr.fn)
    const args = expr.args.fields.map((a) => this.applyExpression(a))

    return {
      applied: {
        ...expr,
        fn: fn.applied,
        args: {
          ...expr.args,
          fields: args.map((a) => a.applied)
        }
      },
      dependencies: uniquePaths(
        ...fn.dependencies,
        ...args.map((a) => a.dependencies).flat()
      )
    }
  }

  private applyChain(expr: Typed.Chain): {
    applied: Chain
    dependencies: Path[]
  } {
    const statements = expr.statements.map((statement) => {
      if (statement._tag == "Assign") {
        const rhs = this.applyExpression(
          statement.rhs as Typed.InstanceExpression
        )
        const applied: Assign = {
          _tag: "Assign",
          name: statement.name,
          equals: statement.equals,
          rhs: rhs.applied
        }

        return {
          applied,
          dependencies: rhs.dependencies
        }
      } else {
        const call = this.applyCall(statement)

        return {
          applied: call.applied,
          dependencies: call.dependencies
        }
      }
    })

    const returns = this.applyExpression(expr.returns)

    return {
      applied: {
        ...expr,
        statements: statements.map((s) => s.applied),
        returns: returns.applied
      },
      dependencies: uniquePaths(
        ...statements.flatMap((s) => s.dependencies),
        ...returns.dependencies
      )
    }
  }

  private applyFuncDef(expr: Typed.FuncDef): {
    applied: FuncDef
    dependencies: Path[]
  } {
    const body = this.applyExpression(expr.body)

    return {
      applied: {
        _tag: "FuncDef",
        args: {
          ...expr.args,
          fields: expr.args.fields.map((a) => a.name)
        },
        arrow: expr.arrow,
        body: body.applied,
        resolved: expr.resolved
      },
      dependencies: body.dependencies
    }
  }

  private applyIfElse(expr: Typed.IfElse): {
    applied: IfElse
    dependencies: Path[]
  } {
    const cond = this.applyExpression(expr.condition)
    const ifBranch = this.applyChain(expr.ifBranch)
    const elseBranch =
      expr.elseBranch._tag == "IfElse"
        ? this.applyIfElse(expr.elseBranch)
        : this.applyChain(expr.elseBranch)

    return {
      applied: {
        ...expr,
        condition: cond.applied,
        ifBranch: ifBranch.applied,
        elseBranch: elseBranch.applied
      },
      dependencies: uniquePaths(
        ...cond.dependencies,
        ...ifBranch.dependencies,
        ...elseBranch.dependencies
      )
    }
  }

  private findParameterDeclaration(path: string): Typed.Declare {
    const parts = path.split("::")
    if (parts.length < 2) {
      throw new Error(`invalid parameter path ${path}`)
    }

    const symbolName = parts.pop()
    if (symbolName === undefined || symbolName.length == 0) {
      throw new Error(`invalid parameter path ${path}`)
    }

    const scriptName = parts.join("::")
    if (scriptName.length == 0) {
      throw new Error(`invalid parameter path ${path}`)
    }

    const script = this.scripts[scriptName]
    if (script === undefined) {
      throw new Error(`script ${scriptName} undefined`)
    }

    let statement: Typed.Declare | undefined
    for (const s of script.statements) {
      if (s._tag == "Declare" && s.name.value == symbolName) {
        statement = s
        break
      }
    }

    if (statement === undefined) {
      throw new Error(`parameter ${symbolName} not found in ${scriptName}`)
    }

    return statement
  }

  /**
   * @param path
   * @param component
   * Used for hidden auto-generated methods (eg. path=`Bool` component=`and`)
   * @returns
   * An InstanceExpression of a symbol, or undefined if the path 
   */
  private findInstanceExpression(path: Path): Typed.InstanceExpression | Raw | undefined {
    const pathStr = pathToString(path)
    if (pathStr in this.builtins) {
      return this.builtins[pathStr]
    }

    const scriptName = pathScriptName(path)
    const script = this.scripts[scriptName]
    if (script === undefined) {
      throw new Error(`script ${scriptName} undefined`)
    }

    const symbolName = pathSymbolName(path)
    const pathStrForError = pathToString(path)

    const statement = script.statements.find(
      (s) =>
        (s._tag == "Assign" || s._tag == "Declare") &&
        s.name.value == symbolName
    )
    if (
      statement === undefined ||
      statement._tag == "Import" ||
      statement._tag == "Comment"
    ) {
      throw new Error(
        `symbol ${symbolName} not found in ${scriptName} (looking up ${pathStrForError})`
      )
    }

    if (path.component !== undefined && path.component !== "") {
      throw new Error("auto-generated symbol components not yet implemented")
    }

    // if the statement is Declare, it must be a parameter
    if (
      this.positionalParams.includes(pathStr) ||
      pathStr in this.substituteParams
    ) {
      if (statement._tag != "Declare") {
        throw new Error(`invalid param ${pathStrForError}`)
      }
    }

    switch (statement._tag) {
      case "Declare":
        if (path.component !== undefined && path.component !== "") {
          throw new Error("data declarations don't have components")
        } else if (this.positionalParams.includes(pathStr)) {
          const ref: Reference = {
            _tag: "Reference",
            path,
            resolved: {
              _tag: "Typed",
              type: statement.type.resolved
            }
          }

          return ref
        } else if (pathStr in this.substituteParams) {
          return this.substituteParams[pathStr]
        } else {
          throw new Error(`unspecified param ${pathStrForError}`)
        }
      case "Assign": {
        const rhs = statement.rhs

        switch (rhs._tag) {
          case "Apply":
          case "FuncDecl":
          case "Generic":
            throw new Error(`${pathStrForError} isn't an instance`)
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
            return rhs
          case "MultiParens":
          case "SingleParens":
            if (Typed.isInstanceParens(rhs)) {
              return rhs
            } else {
              throw new Error(`${pathStrForError} isn't an instance`)
            }
          case "Reference":
            if (Typed.isInstanceReference(rhs)) {
              return rhs
            } else {
              throw new Error(`${pathStrForError} isn't an instance`)
            }
        }
      }
    }
  }
}

function applyMutualDependenciesToReferences(
  expr: Expression,
  deps: Path[]
): Expression {
  const depSet = new Set(deps.map(pathToString))

  switch (expr._tag) {
    case "BinaryOp":
      return {
        ...expr,
        left: applyMutualDependenciesToReferences(expr.left, deps),
        right: applyMutualDependenciesToReferences(expr.right, deps)
      }
    case "Call":
      return {
        ...expr,
        fn: applyMutualDependenciesToReferences(expr.fn, deps),
        args: {
          ...expr.args,
          fields: expr.args.fields.map((a) =>
            applyMutualDependenciesToReferences(a, deps)
          )
        }
      }
    case "Chain":
      return {
        ...expr,
        statements: expr.statements.map((statement) => {
          if (statement._tag == "Assign") {
            return {
              ...statement,
              rhs: applyMutualDependenciesToReferences(statement.rhs, deps)
            }
          }

          return applyMutualDependenciesToReferences(statement, deps) as Call
        }),
        returns: applyMutualDependenciesToReferences(expr.returns, deps)
      }
    case "Construct":
      return {
        ...expr,
        args: {
          ...expr.args,
          fields: expr.args.fields.map((f) => ({
            ...f,
            value: applyMutualDependenciesToReferences(f.value, deps)
          }))
        }
      }
    case "FuncDef":
      return {
        ...expr,
        body: applyMutualDependenciesToReferences(expr.body, deps)
      }
    case "IfElse":
      return {
        ...expr,
        condition: applyMutualDependenciesToReferences(expr.condition, deps),
        ifBranch: applyMutualDependenciesToReferences(
          expr.ifBranch,
          deps
        ) as Chain,
        elseBranch: applyMutualDependenciesToReferences(
          expr.elseBranch,
          deps
        ) as IfElse | Chain
      }
    case "ListConstruct":
      return {
        ...expr,
        args: {
          ...expr.args,
          fields: expr.args.fields.map((a) =>
            applyMutualDependenciesToReferences(a, deps)
          )
        }
      }
    case "Literal":
      return expr
    case "MapConstruct":
      return {
        ...expr,
        args: {
          ...expr.args,
          fields: expr.args.fields.map((f) => ({
            ...f,
            key: applyMutualDependenciesToReferences(f.key, deps),
            value: applyMutualDependenciesToReferences(f.value, deps)
          }))
        }
      }
    case "Member":
      return {
        ...expr,
        object: applyMutualDependenciesToReferences(expr.object, deps)
      }
    case "MultiParens":
      return {
        ...expr,
        group: {
          ...expr.group,
          fields: expr.group.fields.map((a) =>
            applyMutualDependenciesToReferences(a, deps)
          )
        }
      }
    case "Raw":
      return expr
    case "Reference":
      return depSet.has(pathToString(expr.path))
        ? { ...expr, dependencies: deps }
        : expr
    case "SingleParens":
      return {
        ...expr,
        expr: applyMutualDependenciesToReferences(expr.expr, deps)
      }
    case "TemplateString":
      return {
        ...expr,
        tokens: expr.tokens.map((t) =>
          applyMutualDependenciesToReferences(t, deps)
        )
      }
    case "UnaryOp":
      return {
        ...expr,
        right: applyMutualDependenciesToReferences(expr.right, deps)
      }
  }
}

class CodeGenerator {
  expression(expr: Expression): IR.Expression {
    switch (expr._tag) {
      case "BinaryOp":
        return this.binaryOp(expr)
      case "Call":
        return this.call(expr)
      case "Chain":
        return this.chain(expr)
      case "Construct":
        return this.construct(expr)
      case "FuncDef":
        return this.funcDef(expr)
      case "IfElse":
        return this.ifElse(expr)
      case "ListConstruct":
        return this.listConstruct(expr)
      case "Literal":
        return this.literal(expr)
      case "MapConstruct":
        return this.mapConstruct(expr)
      case "Member":
        return this.member(expr)
      case "MultiParens":
        return this.multiParens(expr)
      case "Raw":
        return this.raw(expr)
      case "Reference":
        return this.reference(expr)
      case "SingleParens":
        return this.singleParens(expr)
      case "TemplateString":
        return this.templateString(expr)
      case "UnaryOp":
        return this.unaryOp(expr)
    }
  }

  binaryOp(expr: BinaryOp): IR.Expression {
    const fn = {
      "+": "addInteger",
      "-": "subtractInteger",
      "*": "multiplyInteger",
      "/": "quotientInteger"
    }[expr.op.value]

    if (fn === undefined) {
      throw new Error(`unsupported binary op ${expr.op.value}`)
    }

    const sourceSpan = expr.op.sourceSpan

    return {
      _tag: "Call",
      fn: {
        _tag: "Reference",
        name: {
          _tag: "Word",
          value: fn,
          sourceSpan
        }
      },
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan
        },
        fields: [this.expression(expr.left), this.expression(expr.right)],
        separators: [
          {
            _tag: "Symbol",
            value: ",",
            sourceSpan
          }
        ],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      }
    }
  }

  call(expr: Call): IR.Call {
    return {
      _tag: "Call",
      fn: this.expression(expr.fn),
      args: {
        ...expr.args,
        fields: expr.args.fields.map((arg) => this.expression(arg))
      }
    }
  }

  chain(expr: Chain): IR.Expression {
    let result = this.expression(expr.returns)

    for (let i = expr.statements.length - 1; i >= 0; i--) {
      const statement = expr.statements[i]
      if (statement === undefined) {
        continue
      }

      if (statement._tag == "Assign") {
        const sourceSpan = statement.name.sourceSpan

        result = {
          _tag: "Call",
          fn: {
            _tag: "FuncDef",
            args: {
              _tag: "Group",
              open: {
                _tag: "Symbol",
                value: "(",
                sourceSpan
              },
              fields: [
                {
                  _tag: "Word",
                  value: statement.name.value,
                  sourceSpan
                }
              ],
              separators: [],
              close: {
                _tag: "Symbol",
                value: ")",
                sourceSpan
              }
            },
            arrow: {
              _tag: "Symbol",
              value: "->",
              sourceSpan
            },
            body: {
              open: {
                _tag: "Symbol",
                value: "{",
                sourceSpan
              },
              expr: result,
              close: {
                _tag: "Symbol",
                value: "}",
                sourceSpan
              }
            }
          },
          args: {
            _tag: "Group",
            open: {
              _tag: "Symbol",
              value: "(",
              sourceSpan
            },
            fields: [this.expression(statement.rhs)],
            separators: [],
            close: {
              _tag: "Symbol",
              value: ")",
              sourceSpan
            }
          }
        }
      } else {
        const sourceSpan = statement.args.open.sourceSpan

        result = {
          _tag: "Call",
          fn: {
            _tag: "Reference",
            name: {
              _tag: "Word",
              value: "chooseUnit",
              sourceSpan
            }
          },
          args: {
            _tag: "Group",
            open: {
              _tag: "Symbol",
              value: "(",
              sourceSpan
            },
            fields: [this.call(statement), result],
            separators: [
              {
                _tag: "Symbol",
                value: ",",
                sourceSpan
              }
            ],
            close: {
              _tag: "Symbol",
              value: ")",
              sourceSpan
            }
          }
        }
      }
    }

    return result
  }

  construct(expr: Construct): IR.Call {
    const args = this.constructArgs(expr)
    const sourceSpan = expr.args.open.sourceSpan

    return {
      _tag: "Call",
      fn: {
        _tag: "Reference",
        name: {
          _tag: "Word",
          value: `${Typed.pathToString(expr.resolved.type.path)}:::new`,
          sourceSpan
        }
      },
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan: expr.args.open.sourceSpan
        },
        fields: args,
        separators: expr.args.separators,
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      }
    }
  }

  funcDef(expr: FuncDef): IR.FuncDef {
    return {
      _tag: "FuncDef",
      args: {
        ...expr.args,
        fields: expr.args.fields
      },
      arrow: expr.arrow,
      body: {
        open: {
          _tag: "Symbol",
          value: "{",
          sourceSpan: expr.arrow.sourceSpan
        },
        expr: this.expression(expr.body),
        close: {
          _tag: "Symbol",
          value: "}",
          sourceSpan: expr.arrow.sourceSpan
        }
      }
    }
  }

  ifElse(expr: IfElse): IR.Call {
    const sourceSpan =
      expr.if?.sourceSpan ??
      ("sourceSpan" in expr.condition
        ? expr.condition.sourceSpan
        : Source.DummySpan())

    return {
      _tag: "Call",
      fn: {
        _tag: "Call",
        fn: {
          _tag: "Reference",
          name: {
            _tag: "Word",
            value: "ifThenElse",
            sourceSpan
          }
        },
        args: {
          _tag: "Group",
          open: {
            _tag: "Symbol",
            value: "(",
            sourceSpan
          },
          fields: [
            this.expression(expr.condition),
            this.branchFunc(expr.ifBranch),
            this.branchFunc(expr.elseBranch)
          ],
          separators: [
            {
              _tag: "Symbol",
              value: ",",
              sourceSpan
            },
            {
              _tag: "Symbol",
              value: ",",
              sourceSpan
            }
          ],
          close: {
            _tag: "Symbol",
            value: ")",
            sourceSpan
          }
        }
      },
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan
        },
        fields: [],
        separators: [],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      }
    }
  }

  listConstruct(expr: ListConstruct): IR.Expression {
    const itemType = expr.resolved.type.path.appliedTypes?.[0]

    if (itemType === undefined) {
      throw new Error("expected applied list item type")
    }

    const sourceSpan = expr.args.open.sourceSpan

    return expr.args.fields.reduceRight<IR.Expression>(
      (tail, item) => {
        return {
          _tag: "Call",
          fn: {
            _tag: "Reference",
            name: {
              _tag: "Word",
              value: "mkCons",
              sourceSpan
            }
          },
          args: {
            _tag: "Group",
            open: {
              _tag: "Symbol",
              value: "(",
              sourceSpan
            },
            fields: [
              {
                _tag: "Call",
                fn: {
                  _tag: "Reference",
                  name: {
                    _tag: "Word",
                    value: `${Typed.pathToString(itemType.path)}:::to_data`,
                    sourceSpan
                  }
                },
                args: {
                  _tag: "Group",
                  open: {
                    _tag: "Symbol",
                    value: "(",
                    sourceSpan
                  },
                  fields: [this.expression(item)],
                  separators: [],
                  close: {
                    _tag: "Symbol",
                    value: ")",
                    sourceSpan
                  }
                }
              },
              tail
            ],
            separators: [
              {
                _tag: "Symbol",
                value: ",",
                sourceSpan
              }
            ],
            close: {
              _tag: "Symbol",
              value: ")",
              sourceSpan
            }
          }
        }
      },
      {
        _tag: "Call",
        fn: {
          _tag: "Reference",
          name: {
            _tag: "Word",
            value: "mkNilData",
            sourceSpan
          }
        },
        args: {
          _tag: "Group",
          open: {
            _tag: "Symbol",
            value: "(",
            sourceSpan
          },
          fields: [],
          separators: [],
          close: {
            _tag: "Symbol",
            value: ")",
            sourceSpan
          }
        }
      }
    )
  }

  literal(expr: Literal): IR.Literal {
    switch (expr.value._tag) {
      case "Bool":
        return {
          _tag: "Literal",
          sourceSpan: expr.value.sourceSpan,
          value: {
            _tag: "Bool",
            value: expr.value.value
          }
        }
      case "Bytes":
        return {
          _tag: "Literal",
          sourceSpan: expr.value.sourceSpan,
          value: {
            _tag: "ByteArray",
            value: expr.value.value
          }
        }
      case "Int":
        return {
          _tag: "Literal",
          sourceSpan: expr.value.sourceSpan,
          value: {
            _tag: "Int",
            value: expr.value.value
          }
        }
      case "PlainString":
        return {
          _tag: "Literal",
          sourceSpan: expr.value.sourceSpan,
          value: {
            _tag: "String",
            value: expr.value.value
          }
        }
      case "Real":
        throw new Error("real IR literals are not supported")
    }
  }

  mapConstruct(expr: MapConstruct): IR.Expression {
    const sourceSpan = expr.args.open.sourceSpan

    return expr.args.fields.reduceRight<IR.Expression>(
      (tail, field) => {
        return {
          _tag: "Call",
          fn: {
            _tag: "Reference",
            name: {
              _tag: "Word",
              value: "mkCons",
              sourceSpan
            }
          },
          args: {
            _tag: "Group",
            open: {
              _tag: "Symbol",
              value: "(",
              sourceSpan
            },
            fields: [
              {
                _tag: "Call",
                fn: {
                  _tag: "Reference",
                  name: {
                    _tag: "Word",
                    value: "mkPairData",
                    sourceSpan
                  }
                },
                args: {
                  _tag: "Group",
                  open: {
                    _tag: "Symbol",
                    value: "(",
                    sourceSpan
                  },
                  fields: [
                    this.expression(field.key),
                    this.expression(field.value)
                  ],
                  separators: [
                    {
                      _tag: "Symbol",
                      value: ",",
                      sourceSpan
                    }
                  ],
                  close: {
                    _tag: "Symbol",
                    value: ")",
                    sourceSpan
                  }
                }
              },
              tail
            ],
            separators: [
              {
                _tag: "Symbol",
                value: ",",
                sourceSpan
              }
            ],
            close: {
              _tag: "Symbol",
              value: ")",
              sourceSpan
            }
          }
        }
      },
      {
        _tag: "Call",
        fn: {
          _tag: "Reference",
          name: {
            _tag: "Word",
            value: "mkNilPairData",
            sourceSpan
          }
        },
        args: {
          _tag: "Group",
          open: {
            _tag: "Symbol",
            value: "(",
            sourceSpan
          },
          fields: [],
          separators: [],
          close: {
            _tag: "Symbol",
            value: ")",
            sourceSpan
          }
        }
      }
    )
  }

  member(expr: Member): IR.Call {
    if (expr.object.resolved.type._tag != "DataType") {
      throw new Error("expected member object data type")
    }

    const sourceSpan = expr.member.sourceSpan

    return {
      _tag: "Call",
      fn: {
        _tag: "Reference",
        name: {
          _tag: "Word",
          value: `${Typed.pathToString(expr.object.resolved.type.path)}::${expr.member.value}`,
          sourceSpan
        }
      },
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan
        },
        fields: [this.expression(expr.object)],
        separators: [],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      }
    }
  }

  multiParens(expr: MultiParens): IR.Call {
    const sourceSpan = expr.group.open.sourceSpan
    const fields: IR.Expression[] = [
      {
        _tag: "Literal",
        sourceSpan,
        value: {
          _tag: "Int",
          value: 0n
        }
      },
      ...expr.group.fields.map((arg) => this.expression(arg))
    ]

    return {
      _tag: "Call",
      fn: {
        _tag: "Reference",
        name: {
          _tag: "Word",
          value: "constr",
          sourceSpan
        }
      },
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan: expr.group.open.sourceSpan
        },
        fields,
        separators: [
          { _tag: "Symbol", value: ",", sourceSpan },
          ...expr.group.separators
        ],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan: expr.group.close.sourceSpan
        }
      }
    }
  }

  raw(expr: Raw): IR.Expression {
    return IR.parseExpression({
      name: "raw-ir",
      content: expr.ir
    })
  }

  reference(expr: Reference): IR.Reference {
    const last = expr.path.names.at(-1)
    const sourceSpan =
      expr.path.names.length == 1 && last ? last.sourceSpan : Source.DummySpan()

    return {
      _tag: "Reference",
      name: {
        _tag: "Word",
        value: pathToString(expr.path),
        sourceSpan
      }
    }
  }

  singleParens(expr: SingleParens): IR.Expression {
    return this.expression(expr.expr)
  }

  templateString(_expr: TemplateString): IR.Expression {
    throw new Error("not yet implemented")
  }

  unaryOp(expr: UnaryOp): IR.Expression {
    if (expr.op.value == "-") {
      const sourceSpan = expr.op.sourceSpan

      return {
        _tag: "Call",
        fn: {
          _tag: "Reference",
          name: {
            _tag: "Word",
            value: "subtractInteger",
            sourceSpan
          }
        },
        args: {
          _tag: "Group",
          open: {
            _tag: "Symbol",
            value: "(",
            sourceSpan
          },
          fields: [
            {
              _tag: "Literal",
              sourceSpan,
              value: {
                _tag: "Int",
                value: 0n
              }
            },
            this.expression(expr.right)
          ],
          separators: [
            {
              _tag: "Symbol",
              value: ",",
              sourceSpan
            }
          ],
          close: {
            _tag: "Symbol",
            value: ")",
            sourceSpan
          }
        }
      }
    }

    throw new Error(`unsupported unary op ${expr.op.value}`)
  }

  private branchFunc(expr: Chain | IfElse): IR.FuncDef {
    const sourceSpan =
      expr._tag == "Chain"
        ? (expr.open?.sourceSpan ??
          ("sourceSpan" in expr.returns
            ? expr.returns.sourceSpan
            : Source.DummySpan()))
        : (expr.if?.sourceSpan ??
          ("sourceSpan" in expr.condition
            ? expr.condition.sourceSpan
            : Source.DummySpan()))

    return {
      _tag: "FuncDef",
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan
        },
        fields: [],
        separators: [],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      },
      arrow: {
        _tag: "Symbol",
        value: "->",
        sourceSpan
      },
      body: {
        open: {
          _tag: "Symbol",
          value: "{",
          sourceSpan
        },
        expr: expr._tag == "Chain" ? this.chain(expr) : this.ifElse(expr),
        close: {
          _tag: "Symbol",
          value: "}",
          sourceSpan
        }
      }
    }
  }

  private constructArgs(expr: Construct): IR.Expression[] {
    const hasKeys = expr.args.fields.some(
      (field) => field.property !== undefined
    )
    if (!hasKeys) {
      return expr.args.fields.map((field) => this.expression(field.value))
    }

    const keyed = new Map<string, IR.Expression>()
    const positional: IR.Expression[] = []

    expr.args.fields.forEach((field) => {
      const value = this.expression(field.value)

      if (field.property) {
        keyed.set(field.property.key.value, value)
      } else {
        positional.push(value)
      }
    })

    const ordered: IR.Expression[] = []
    Object.keys(expr.resolved.type.properties).forEach((property) => {
      const value = keyed.get(property)
      if (value !== undefined) {
        ordered.push(value)
        keyed.delete(property)
        return
      }

      const nextPositional = positional.shift()
      if (nextPositional !== undefined) {
        ordered.push(nextPositional)
      }
    })

    if (keyed.size > 0) {
      throw new Error(
        `unknown construct keys: ${Array.from(keyed.keys()).join(", ")}`
      )
    }

    return [...ordered, ...positional]
  }
}

export function generateIR(expr: Expression): IR.Expression {
  return new CodeGenerator().expression(expr)
}

export function generateEntryPointIR(entryPoint: EntryPoint): IR.Expression {
  let result = generateIR(entryPoint.body)

  for (let i = entryPoint.definitions.length - 1; i >= 0; i--) {
    const definition = entryPoint.definitions[i]

    if (definition === undefined) {
      continue
    }

    result = wrapWithDefinition(
      pathToString(definition.path),
      generateIR(definition.expr),
      result
    )
  }

  for (let i = entryPoint.parameters.length - 1; i >= 0; i--) {
    const parameter = entryPoint.parameters[i]

    if (parameter === undefined) {
      continue
    }

    result = wrapWithFuncDef(pathToString(parameter.path), result)
  }

  return result
}

function wrapWithDefinition(
  name: string,
  value: IR.Expression,
  body: IR.Expression
): IR.Expression {
  const sourceSpan = Source.DummySpan()

  return {
    _tag: "Call",
    fn: {
      _tag: "FuncDef",
      args: {
        _tag: "Group",
        open: {
          _tag: "Symbol",
          value: "(",
          sourceSpan
        },
        fields: [
          {
            _tag: "Word",
            value: name,
            sourceSpan
          }
        ],
        separators: [],
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      },
      arrow: {
        _tag: "Symbol",
        value: "->",
        sourceSpan
      },
      body: {
        open: {
          _tag: "Symbol",
          value: "{",
          sourceSpan
        },
        expr: body,
        close: {
          _tag: "Symbol",
          value: "}",
          sourceSpan
        }
      }
    },
    args: {
      _tag: "Group",
      open: {
        _tag: "Symbol",
        value: "(",
        sourceSpan
      },
      fields: [value],
      separators: [],
      close: {
        _tag: "Symbol",
        value: ")",
        sourceSpan
      }
    }
  }
}

function wrapWithFuncDef(name: string, body: IR.Expression): IR.Expression {
  const sourceSpan = Source.DummySpan()

  return {
    _tag: "FuncDef",
    args: {
      _tag: "Group",
      open: {
        _tag: "Symbol",
        value: "(",
        sourceSpan
      },
      fields: [
        {
          _tag: "Word",
          value: name,
          sourceSpan
        }
      ],
      separators: [],
      close: {
        _tag: "Symbol",
        value: ")",
        sourceSpan
      }
    },
    arrow: {
      _tag: "Symbol",
      value: "->",
      sourceSpan
    },
    body: {
      open: {
        _tag: "Symbol",
        value: "{",
        sourceSpan
      },
      expr: body,
      close: {
        _tag: "Symbol",
        value: "}",
        sourceSpan
      }
    }
  }
}
