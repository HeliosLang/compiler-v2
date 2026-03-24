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

export type Path = Typed.Path

function pathToString(path: Path): string {
  return Typed.pathToString(path)
}

function pathScriptName(path: Path): string {
  if (path.names.length < 2) {
    throw new Error(
      `expected 2 path elements to be able to extract script name, got ${path.names.map((n) => n.value).join("::")}`
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
  readonly parameters: Path[]

  /**
   * Builtin and user and definitions
   */
  readonly definitions: Definition[]

  /**
   * True for main in validator script, false for any other function or symbol
   */
  readonly isValidator: boolean

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
  readonly args: Token.Group<
    "(",
    { name: Token.Word; colon: Token.Symbol<":">; type: Typed.Type }
  > // Type is still needed for correct IR generation
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

export type Globals = Record<string, Typed.SymbolValueWithImplementation>

export function makeBuiltins(
  globals: Globals
): Record<string, Raw | undefined> {
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

        result[pathToString(symbolPath)] = {
          ...applier.applyEntryPoint(symbolPath),
          isValidator: true
        }
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
      (d) => pathToString(d.path) != pathToString(entryPointPath)
    )

    return {
      _tag: "EntryPoint",
      parameters: this.positionalParams.map((pp) => {
        const declare = this.findParameterDeclaration(pp)

        return declare.path
      }),
      definitions,
      isValidator: false, // determined by caller
      body: entryPointDef.expr
    }
  }

  private orderDefinitions(
    graph: Readonly<Record<string, Definition>>
  ): Definition[] {
    const ordered: Definition[] = []
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
        for (const def of picked) {
          const deps = (def.dependencies ?? []).filter((d) => {
            const depKey = pathToString(d)
            return depKey in graph && !done.has(depKey)
          })
          ordered.push({
            ...def,
            dependencies: deps
          })

          done.add(pathToString(def.path))
        }
      }
    }

    const dependencyMap = Object.fromEntries(
      ordered
        .filter((definition) => (definition.dependencies?.length ?? 0) > 0)
        .map((definition) => [
          pathToString(definition.path),
          definition.dependencies ?? []
        ])
    )

    return ordered.map((definition) => ({
      ...definition,
      expr: applyDefinitionDependenciesToReferences(
        definition.expr,
        dependencyMap
      )
    }))
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
    let isEntryPoint = true

    while (head !== undefined) {
      const headPathStr = pathToString(head.path)
      if (!(headPathStr in definitions)) {
        const { applied, dependencies } = this.applyExpression(head.expr)

        if (isEntryPoint) {
          // Entry point argument decoding is inlined in generateEntryPointIR().
        }

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
      isEntryPoint = false
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
      case "Apply": {
        const path =
          expr.resolved.path ??
          (expr.gtype._tag == "Reference"
            ? ({ ...expr.gtype.path } as Path)
            : undefined)

        if (path === undefined) {
          throw new Error("unable to lower anonymous instance apply")
        }

        return {
          applied: {
            _tag: "Reference",
            path,
            resolved: expr.resolved
          },
          dependencies: path.names.length < 2 ? [] : [path]
        }
      }
      case "As":
        return this.applyAs(expr)
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

        const objectDataType = object.applied.resolved.type
        if (objectDataType._tag != "DataType") {
          throw new Error("Unexpected")
        }

        const memberDeps: Typed.Path[] =
          objectDataType.properties[expr.member.value]?.implementation?.deps ??
          []

        return {
          applied: {
            ...expr,
            object: object.applied
          },
          dependencies: [...object.dependencies, ...memberDeps]
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
          dependencies: expr.resolved.path ? [expr.resolved.path] : []
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

  private applyAs(expr: Typed.As): {
    applied: Expression
    dependencies: Path[]
  } {
    const left = this.applyExpression(expr.left)
    const targetType = expr.resolved.type
    const fromData = targetType.from_data

    if (fromData === undefined) {
      throw new Error(
        `missing from_data for ${Typed.pathToString(targetType.path)}`
      )
    }

    const sourceSpan = expr.as.sourceSpan

    return {
      applied: {
        _tag: "Call",
        fn: {
          _tag: "Raw",
          resolved: {
            _tag: "Typed",
            type: {
              _tag: "FuncType",
              args: [
                {
                  _tag: "DataType",
                  path: Untyped.makePath(Source.DummySpan(), "Data"),
                  properties: {},
                  variants: {}
                }
              ],
              returns: targetType
            }
          },
          ir: fromData.ir,
          dependencies: fromData.deps
        },
        args: {
          _tag: "Group",
          open: {
            _tag: "Symbol",
            value: "(",
            sourceSpan
          },
          fields: [left.applied],
          separators: [],
          close: {
            _tag: "Symbol",
            value: ")",
            sourceSpan
          }
        },
        resolved: expr.resolved
      },
      dependencies: uniquePaths(...left.dependencies, ...fromData.deps)
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
          fields: expr.args.fields.map((a) => ({
            name: a.name,
            colon: a.type.colon,
            type: a.type.resolved
          }))
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
   * @returns
   * An InstanceExpression of a symbol, or undefined if the path
   */
  private findInstanceExpression(
    path: Path
  ): Typed.InstanceExpression | Raw | undefined {
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
      if (statement._tag == "Declare") {
        throw new Error(
          `component ${path.component} only exists on types, not typed declarations`
        )
      }

      const dataType = statement.rhs.resolved

      if (dataType._tag != "DataType") {
        throw new Error(
          `component ${path.component} not available in ${dataType._tag}`
        )
      }

      const prop = dataType.properties[path.component]

      if (prop === undefined) {
        throw new Error(
          `component ${path.component} undefined in ${pathToString(dataType.path)}`
        )
      }

      if (prop.implementation === undefined) {
        throw new Error(`${pathToString(path)} doesn't have an implementation`)
      }

      return {
        _tag: "Raw",
        ir: prop.implementation.ir,
        dependencies: prop.implementation.deps,
        resolved: { _tag: "Typed", type: prop.symbolValue }
      }
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
          case "Switch":
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
  return applyDefinitionDependenciesToReferences(
    expr,
    Object.fromEntries(deps.map((dep) => [pathToString(dep), deps]))
  )
}

function applyDefinitionDependenciesToReferences(
  expr: Expression,
  dependencyMap: Readonly<Record<string, Path[]>>
): Expression {
  const rewrite = (subExpr: Expression) =>
    applyDefinitionDependenciesToReferences(subExpr, dependencyMap)

  switch (expr._tag) {
    case "BinaryOp":
      return {
        ...expr,
        left: rewrite(expr.left),
        right: rewrite(expr.right)
      }
    case "Call":
      return {
        ...expr,
        fn: rewrite(expr.fn),
        args: {
          ...expr.args,
          fields: expr.args.fields.map(rewrite)
        }
      }
    case "Chain":
      return {
        ...expr,
        statements: expr.statements.map((statement) => {
          if (statement._tag == "Assign") {
            return {
              ...statement,
              rhs: rewrite(statement.rhs)
            }
          }

          return rewrite(statement) as Call
        }),
        returns: rewrite(expr.returns)
      }
    case "Construct":
      return {
        ...expr,
        args: {
          ...expr.args,
          fields: expr.args.fields.map((f) => ({
            ...f,
            value: rewrite(f.value)
          }))
        }
      }
    case "FuncDef":
      return {
        ...expr,
        body: rewrite(expr.body)
      }
    case "IfElse":
      return {
        ...expr,
        condition: rewrite(expr.condition),
        ifBranch: rewrite(expr.ifBranch) as Chain,
        elseBranch: rewrite(expr.elseBranch) as IfElse | Chain
      }
    case "ListConstruct":
      return {
        ...expr,
        args: {
          ...expr.args,
          fields: expr.args.fields.map(rewrite)
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
            key: rewrite(f.key),
            value: rewrite(f.value)
          }))
        }
      }
    case "Member":
      return {
        ...expr,
        object: rewrite(expr.object)
      }
    case "MultiParens":
      return {
        ...expr,
        group: {
          ...expr.group,
          fields: expr.group.fields.map(rewrite)
        }
      }
    case "Raw":
      return expr
    case "Reference": {
      const refPath = expr.resolved.path ?? expr.path
      const refDeps = dependencyMap[pathToString(refPath)]

      return refDeps !== undefined && refDeps.length > 0
        ? { ...expr, dependencies: refDeps }
        : expr
    }
    case "SingleParens":
      return {
        ...expr,
        expr: rewrite(expr.expr)
      }
    case "TemplateString":
      return {
        ...expr,
        tokens: expr.tokens.map(rewrite)
      }
    case "UnaryOp":
      return {
        ...expr,
        right: rewrite(expr.right)
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
    const sourceSpan = expr.op.sourceSpan
    const callBuiltin = (name: string, args: IR.Expression[]): IR.Call => ({
      _tag: "Call",
      fn: {
        _tag: "Reference",
        name: {
          _tag: "Word",
          value: name,
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
        fields: args,
        separators: args.slice(1).map(() => ({
          _tag: "Symbol",
          value: ",",
          sourceSpan
        })),
        close: {
          _tag: "Symbol",
          value: ")",
          sourceSpan
        }
      }
    })

    if (expr.op.value == "==") {
      const operandType = expr.left.resolved.type

      if (operandType._tag != "DataType") {
        throw new Error("expected data type for equality op")
      }

      const left = this.expression(expr.left)
      const right = this.expression(expr.right)
      const typeName = pathToString(operandType.path)

      switch (typeName) {
        case "Int":
          return callBuiltin("equalsInteger", [left, right])
        case "Data":
          return callBuiltin("equalsData", [left, right])
        case "String":
          return callBuiltin("equalsString", [left, right])
        case "ByteArray":
          return callBuiltin("equalsByteString", [left, right])
        case "Bool":
          return callBuiltin("ifThenElse", [
            left,
            right,
            callBuiltin("ifThenElse", [
              right,
              {
                _tag: "Literal",
                sourceSpan,
                value: {
                  _tag: "Bool",
                  value: false
                }
              },
              {
                _tag: "Literal",
                sourceSpan,
                value: {
                  _tag: "Bool",
                  value: true
                }
              }
            ])
          ])
        default:
          throw new Error(`unsupported equality type ${typeName}`)
      }
    }

    const fn = {
      "+": "addInteger",
      "-": "subtractInteger",
      "*": "multiplyInteger",
      "/": "quotientInteger"
    }[expr.op.value]

    if (fn === undefined) {
      throw new Error(`unsupported binary op ${expr.op.value}`)
    }

    return callBuiltin(fn, [
      this.expression(expr.left),
      this.expression(expr.right)
    ])
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
        fields: expr.args.fields.map((f) => f.name)
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

  member(expr: Member): IR.Expression {
    if (expr.object.resolved.type._tag != "DataType") {
      throw new Error("expected member object data type")
    }

    const prop = expr.object.resolved.type.properties[expr.member.value]

    if (prop === undefined || prop.implementation === undefined) {
      throw new Error(
        `missing implementation for member '${expr.member.value}'`
      )
    }

    return IR.makeCall(
      IR.parseExpression({
        name: "member-ir",
        content: prop.implementation.ir
      }),
      [this.expression(expr.object)]
    )
  }

  multiParens(expr: MultiParens): IR.Expression {
    const sourceSpan = expr.group.open.sourceSpan

    if (expr.group.fields.length == 0) {
      return {
        _tag: "Literal",
        sourceSpan,
        value: {
          _tag: "Unit"
        }
      }
    }

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
        isCalled: true,
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

  reference(expr: Reference): IR.Expression {
    const path = expr.resolved.path ?? expr.path
    const last = path.names.at(-1)
    const sourceSpan =
      path.names.length == 1 && last ? last.sourceSpan : Source.DummySpan()
    const ref: IR.Reference = {
      _tag: "Reference",
      name: {
        _tag: "Word",
        value: pathToString(path),
        sourceSpan
      }
    }

    return expr.dependencies && expr.dependencies.length > 0
      ? IR.makeCall(
          ref,
          expr.dependencies.map((dep) => IR.makeReference(pathToString(dep)))
        )
      : ref
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
  const makeFromDataCall = (
    type: Typed.DataType,
    value: IR.Expression
  ): IR.Expression => {
    const fromData = type.from_data

    if (fromData === undefined) {
      throw new Error(`missing from_data for ${Typed.pathToString(type.path)}`)
    }

    return IR.makeCall(
      IR.parseExpression({
        name: "from-data-ir",
        content: fromData.ir
      }),
      [value]
    )
  }

  const body = entryPoint.definitions.reduce((expr, definition) => {
    const dependencies = definition.dependencies ?? []

    return dependencies.length > 0
      ? applyMutualDependenciesToReferences(expr, dependencies)
      : expr
  }, entryPoint.body)
  let result = generateIR(body)

  // wrap with data conversion of args
  if (entryPoint.isValidator) {
    if (body._tag != "FuncDef") {
      throw new Error("Unexpected")
    }

    const redeemerArg = body.args.fields[0]
    if (redeemerArg.type._tag != "DataType") {
      throw new Error("Unexpected")
    }

    const redeemerExpr: IR.Expression = Typed.isIgnoredFunctionArg(redeemerArg.name.value) ? {_tag: "Literal", value: {_tag: "Unit"}, sourceSpan: Source.DummySpan()} : IR.makeBuiltinCall("headList", [
      IR.makeBuiltinCall("tailList", [
        IR.makeBuiltinCall("sndPair", [
          IR.makeBuiltinCall("unConstrData", [
            IR.makeReference("scriptContextData")
          ])
        ])
      ])
    ])

    

    if (pathToString(redeemerArg.type.path) != "Data") {
      result = makeFromDataCall(redeemerArg.type, redeemerExpr)
    }

    // wrap with a call with the redeemer arg (headList(tailList(sndPair(unConstrData(scriptContextData)))))
    result = IR.makeCall(result, [redeemerExpr])
  } else if (
    body._tag == "FuncDef" &&
    body.args.fields.some(
      (f) => f.type._tag == "DataType" && pathToString(f.type.path) != "Data"
    )
  ) {
    result = IR.makeCall(
      result,
      body.args.fields.map((f) => {
        if (f.type._tag == "DataType" && pathToString(f.type.path) != "Data") {
          return makeFromDataCall(f.type, IR.makeReference(f.name.value))
        } else {
          return IR.makeReference(f.name.value)
        }
      })
    )

    result = IR.makeFuncDef(
      body.args.fields.map((f) => f.name.value),
      result,
      true
    )
  }

  for (let i = entryPoint.definitions.length - 1; i >= 0; i--) {
    const definition = entryPoint.definitions[i]

    if (definition === undefined) {
      continue
    }

    if (
      entryPoint.parameters.some(
        (p) => pathToString(p) == pathToString(definition.path)
      )
    ) {
      continue
    }

    const value = generateIR(definition.expr)
    const dependencies = definition.dependencies ?? []

    result = wrapWithDefinition(
      pathToString(definition.path),
      dependencies.length > 0
        ? IR.makeFuncDef(dependencies.map(pathToString), value, false)
        : value,
      result
    )
  }

  // wrap with scriptContextData here
  result = IR.makeFuncDef(["scriptContextData"], result, true)

  for (let i = entryPoint.parameters.length - 1; i >= 0; i--) {
    const parameter = entryPoint.parameters[i]

    if (parameter === undefined) {
      continue
    }

    result = IR.makeFuncDef([pathToString(parameter)], result, true)
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
