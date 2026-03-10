import * as Source from "../Source/index.js"
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
    return `${Typed.pathToString(path)}${path.component ? `:::${path.component}` : ""}`
}

function pathScriptName(path: Path): string {
    if (path.names.length < 2) {
        throw new Error("expected 2 path elements to be able to extract script name")
    }

    return path.names.slice(0, -1).map(n => n.value).join("::")
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

    paths.forEach(p => m.set(pathToString(p), p))

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
    readonly fn: Expression,
    readonly args: Token.Group<"(", Expression>
}

export interface Chain extends Omit<Typed.Chain, "statements" | "returns"> {
    readonly statements: (Assign | Call)[]
    readonly returns: Expression
}

export interface MapConstruct extends Omit<Typed.MapConstruct, "type" | "args"> {
  readonly args: Token.Group<
    "{",
    {
      readonly key: Expression
      readonly colon: Token.Symbol<":">
      readonly value: Expression
    }
  >
}

export interface ListConstruct extends Omit<Typed.ListConstruct, "type" | "args"> {
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

export interface FuncDef extends Omit<Typed.FuncDef, "args" | "returns" | "body"> {
    readonly args: Token.Group<"(", Token.Word>
    readonly body: Expression
}

export interface IfElse extends Omit<Typed.IfElse, "condition" | "ifBranch" | "elseBranch"> {
    readonly condition: Expression
    readonly ifBranch: Chain
    readonly elseBranch: IfElse | Chain
}

export type Literal = Typed.Literal

export interface Member extends Omit<Typed.Member, "object"> {
    readonly object: Expression
}

export interface MultiParens extends Omit<Typed.MultiParens<Typed.Typed<Typed.DataType>>, "group"> {
    readonly group: Token.Group<"(", Expression>
}

export interface SingleParens extends Omit<Typed.SingleParens<Typed.Typed>, "expr"> {
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

export interface Reference extends Typed.Reference<Typed.Typed> {
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
    builtins?: Readonly<Record<string, Raw>> | undefined
    positionalParams?: readonly string[] | undefined
    substituteParams?: Readonly<Record<string, Raw>> | undefined
}

export function parseEntryPoints(
    srcs: Source.Source[],
    options: {
        compileFunctions?: boolean | undefined,
        globals: Record<string, {symbolValue: Typed.SymbolValue, implementation?: {ir: string, deps: string[]}}>,
        positionalParams?: readonly string[],
        substituteParams?: Readonly<Record<string, Raw>> | undefined // TODO: prefer UplcData as input instead, and convert to Raw internally
    }
): Record<string, EntryPoint> {
    const scripts = Typed.parseScripts(srcs, Object.fromEntries(Object.entries(options.globals ?? {}).map(([k, v]) => [k, v.symbolValue])))

    const builtins: Record<string, Raw> = {}

    for (let k in (options.globals ?? {})) {
        const v = options.globals[k]

        if (v.implementation && v.symbolValue._tag == "Typed") {
            builtins[k] = {
                _tag: "Raw",
                ir: v.implementation.ir,
                dependencies: v.implementation.deps.map(d => Untyped.makePath(Source.DummySpan(), d)),
                resolved: v.symbolValue
            }
        }
    }

    return buildEntryPoints(scripts, {
        builtins,
        positionalParams: options.positionalParams,
        substituteParams: options.substituteParams,
        compileFunctions: options.compileFunctions
    })
}

export function buildEntryPoints(scripts: Readonly<Record<string, Typed.Script>>, {
    builtins = {},
    positionalParams = [], 
    substituteParams = {}, 
    compileFunctions = false
}: BuildOptions): Record<string, EntryPoint> {
    const result: Record<string, EntryPoint> = {}

    const applier = new Applier(
        builtins,scripts,positionalParams, substituteParams
    )

    for (let script of Object.values(scripts)) {
        for (let statement of script.statements) {
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
    readonly builtins: Readonly<Record<string, Raw>>
    readonly scripts: Readonly<Record<string, Typed.Script>>
    readonly positionalParams: readonly string[]
    readonly substituteParams: Readonly<Record<string, Raw>>

    constructor(
        builtins: Readonly<Record<string, Raw>>, 
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
                throw new Error(`parameter ${path} can't be both positional and substituted`)
            }
        }

        for (const path in this.substituteParams) {
            this.findParameterDeclaration(path)

            if (this.positionalParams.includes(path)) {
                throw new Error(`parameter ${path} can't be both substituted and positional`)
            }
        }
    }

    applyEntryPoint(entryPointPath: Typed.Path): EntryPoint {
        const graph = this.createDefinitionGraph(entryPointPath)

        let definitions = this.orderDefinitions(graph)

        const entryPointDef = definitions.find(d => pathToString(d.path) == pathToString(entryPointPath))

        if (!entryPointDef) {
            throw new Error("unexpected")
        }

        definitions = definitions.filter(d => pathToString(d.path) == pathToString(entryPointPath))

        return {
            _tag: "EntryPoint",
            parameters: this.positionalParams.map(pp => this.findParameterDeclaration(pp)),
            definitions,
            body: entryPointDef.expr
        }
    }

    private orderDefinitions(graph: Readonly<Record<string, Definition>>): Definition[] {
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

                const nonDoneDeps = new Set((def.dependencies ?? []).map(pathToString).filter(depKey => {
                    return (depKey in graph) && !done.has(depKey)
                }))

                if (picked.length == 0) {
                    picked = [def]
                    pickedNonDoneDeps = nonDoneDeps
                } else if (
                    nonDoneDeps.size < pickedNonDoneDeps.size
                ) {
                    picked = [def]
                    pickedNonDoneDeps = nonDoneDeps
                } else if (nonDoneDeps.size == pickedNonDoneDeps.size && nonDoneDeps.difference(pickedNonDoneDeps).size == 0) {
                    picked.push(def)
                }
            }

            if (picked.length == 0) {
                break
            } else {
                // the first definition in the mutually dependent group determines the order of the deps
                let deps = (picked[0].dependencies ?? []).filter(d => pickedNonDoneDeps.has(pathToString(d)))

                for (let def of picked) {
                    let expr = def.expr
                    if (deps.length > 0) {
                        expr = applyMutualDependenciesToReferences(expr, deps)
                    }

                    definitions.push({
                        ...def,
                        dependencies: deps
                    })

                    done.add(pathToString(def.path))
                }
            }
        }

        return definitions
    }

    private createDefinitionGraph(entryPointPath: Typed.Path): Readonly<Record<string, Definition>> {
        const entryPoint = this.findInstanceExpression(entryPointPath)

        /**
         * The string key is the stringified path of the Definition
         */
        const definitions: Record<string, Definition> = {}

        const stack: {path: Path, expr: Typed.InstanceExpression | Raw}[] = [{path: entryPointPath, expr: entryPoint}]
        let head = stack.pop()

        while (head !== undefined) {
            const headPathStr = pathToString(head.path)
            if (!(headPathStr in definitions)) {
                const {applied, dependencies} = this.applyExpression(head.expr)

                definitions[headPathStr] = {
                    _tag: "Definition",
                    expr: applied,
                    dependencies,
                    path: head.path
                }

                for (let dep of dependencies) {
                    if (pathToString(dep) in definitions) {
                        continue
                    }

                    stack.push({
                        path: dep,
                        expr: this.findInstanceExpression(dep)
                    })
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
    private applyExpression(expr: Typed.InstanceExpression | Raw): {applied: Expression, dependencies: Path[]} {
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
                const args = expr.args.fields.map(a => this.applyExpression(a.value))

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
                    dependencies: uniquePaths(expr.resolved.type.path, ...args.map(a => a.dependencies).flat())
                }
            }
            case "FuncDef":
                return this.applyFuncDef(expr)
            case "IfElse":
                return this.applyIfElse(expr)
            case "ListConstruct": {
                const args = expr.args.fields.map(a => this.applyExpression(a))

                return {
                    applied: {
                        _tag: "ListConstruct",
                        args: {
                            ...expr.args,
                            fields: args.map(a => a.applied)
                        },
                        resolved: expr.resolved
                    },
                    dependencies: uniquePaths(expr.resolved.type.path, ...args.map(a => a.dependencies).flat())
                }
            }
            case "Literal":
                return {applied: expr, dependencies: []}
            case "MapConstruct": {
                const args = expr.args.fields.map(f => ({
                    key: this.applyExpression(f.key),
                    colon: f.colon,
                    value: this.applyExpression(f.value)
                }))

                return {
                    applied: {
                        _tag: "MapConstruct",
                        args: {
                            ...expr.args,
                            fields: args.map(a => ({
                                key: a.key.applied,
                                colon: a.colon,
                                value: a.value.applied
                            }))
                        },
                        resolved: expr.resolved
                    },
                    dependencies: uniquePaths(
                        expr.resolved.type.path,
                        ...args.flatMap(a => [...a.key.dependencies, ...a.value.dependencies])
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
                const args = expr.group.fields.map(a => this.applyExpression(a))

                return {
                    applied: {
                        ...expr,
                        group: {
                            ...expr.group,
                            fields: args.map(a => a.applied)
                        }
                    },
                    dependencies: uniquePaths(...args.map(a => a.dependencies).flat())
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
                const tokens = expr.tokens.map(t => this.applyExpression(t))

                return {
                    applied: {
                        ...expr,
                        tokens: tokens.map(t => t.applied)
                    },
                    dependencies: uniquePaths(...tokens.flatMap(t => t.dependencies))
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

    private applyCall(expr: Typed.Call): {applied: Call, dependencies: Path[]} {
        const fn = this.applyExpression(expr.fn)
        const args = expr.args.fields.map(a => this.applyExpression(a))

        return {
            applied: {
                ...expr,
                fn: fn.applied,
                args: {
                    ...expr.args,
                    fields: args.map(a => a.applied)
                }
            },
            dependencies: uniquePaths(...fn.dependencies, ...args.map(a => a.dependencies).flat())
        }
    }

    private applyChain(expr: Typed.Chain): {applied: Chain, dependencies: Path[]} {
        const statements = expr.statements.map(statement => {
            if (statement._tag == "Assign") {
                const rhs = this.applyExpression(statement.rhs as Typed.InstanceExpression)
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
                statements: statements.map(s => s.applied),
                returns: returns.applied
            },
            dependencies: uniquePaths(
                ...statements.flatMap(s => s.dependencies),
                ...returns.dependencies
            )
        }
    }

    private applyFuncDef(expr: Typed.FuncDef): {applied: FuncDef, dependencies: Path[]} {
        const body = this.applyExpression(expr.body)

        return {
            applied: {
                _tag: "FuncDef",
                args: {
                    ...expr.args,
                    fields: expr.args.fields.map(a => a.name)
                },
                arrow: expr.arrow,
                body: body.applied,
                resolved: expr.resolved
            },
            dependencies: body.dependencies
        }
    }

    private applyIfElse(expr: Typed.IfElse): {applied: IfElse, dependencies: Path[]} {
        const cond = this.applyExpression(expr.condition)
        const ifBranch = this.applyChain(expr.ifBranch)
        const elseBranch = expr.elseBranch._tag == "IfElse" ? this.applyIfElse(expr.elseBranch) : this.applyChain(expr.elseBranch)

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
     * An InstanceExpression of a symbol
     */
    private findInstanceExpression(path: Path): Typed.InstanceExpression | Raw {
        const pathStr = pathToString(path)
        if (pathStr in this.builtins) {
            return this.builtins[pathStr]
        }

        const scriptName = pathScriptName(path)
        const script = this.scripts[scriptName]
        if (script === undefined) {
            throw new Error(`script ${scriptName} undefined`)
        }
        

        let symbolName = pathSymbolName(path)
        if (symbolName === undefined) {
            throw new Error(`invalid path ${path}`)
        }

        const statement = script.statements.find(s => (s._tag == "Assign" || s._tag == "Declare") && s.name.value == symbolName)
        if (statement === undefined || statement._tag == "Import" || statement._tag == "Comment") {
            throw new Error(`symbol ${symbolName} not found in ${scriptName} (looking up ${path})`)
        }

        if (path.component) {
            throw new Error("auto-generated symbol components not yet implemented")
        }

        // if the statement is Declare, it must be a parameter
        if (this.positionalParams.includes(pathStr) || pathStr in this.substituteParams) {
            if (statement._tag != "Declare") {
                throw new Error(`invalid param ${path}`)
            }
        }
        
        switch (statement._tag) {
            case "Declare":
                if (path.component) {
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
                    throw new Error(`unspecified param ${path}`)
                }
            case "Assign": {
                const rhs = statement.rhs

                switch (rhs._tag) {
                    case "Apply":
                    case "FuncDecl":
                    case "Generic":
                        throw new Error(`${path} isn't an instance`)
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
                            throw new Error(`${path} isn't an instance`)
                        }
                    case "Reference":
                        if (Typed.isInstanceReference(rhs)) {
                            return rhs
                        } else {
                            throw new Error(`${path} isn't an instance`)
                        }       
                }
            }
        }
    }
}

function applyMutualDependenciesToReferences(expr: Expression, deps: Path[]): Expression {
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
                    fields: expr.args.fields.map(a => applyMutualDependenciesToReferences(a, deps))
                }
            }
        case "Chain":
            return {
                ...expr,
                statements: expr.statements.map(statement => {
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
                    fields: expr.args.fields.map(f => ({
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
                ifBranch: applyMutualDependenciesToReferences(expr.ifBranch, deps) as Chain,
                elseBranch: applyMutualDependenciesToReferences(expr.elseBranch, deps) as IfElse | Chain
            }
        case "ListConstruct":
            return {
                ...expr,
                args: {
                    ...expr.args,
                    fields: expr.args.fields.map(a => applyMutualDependenciesToReferences(a, deps))
                }
            }
        case "Literal":
            return expr
        case "MapConstruct":
            return {
                ...expr,
                args: {
                    ...expr.args,
                    fields: expr.args.fields.map(f => ({
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
                    fields: expr.group.fields.map(a => applyMutualDependenciesToReferences(a, deps))
                }
            }
        case "Raw":
            return expr
        case "Reference":
            return depSet.has(pathToString(expr.path as Path)) ? {...expr, dependencies: deps} : expr
        case "SingleParens":
            return {
                ...expr,
                expr: applyMutualDependenciesToReferences(expr.expr, deps)
            }
        case "TemplateString":
            return {
                ...expr,
                tokens: expr.tokens.map(t => applyMutualDependenciesToReferences(t, deps))
            }
        case "UnaryOp":
            return {
                ...expr,
                right: applyMutualDependenciesToReferences(expr.right, deps)
            }
    }
}
