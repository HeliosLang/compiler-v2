import * as Source from "./Source.js"

class Base extends Error {
  /**
   * Unformatted message
   */
  readonly origMessage: string

  readonly sourceSpan: Source.Span

  constructor(sourceSpan: Source.Span, message: string) {
    // TODO: calculate line and column number
    super(`${sourceSpan.source.name}:${sourceSpan.start}: ${message}`)

    this.origMessage = message
    this.sourceSpan = sourceSpan
  }
}

export class Reference extends Base {}
export class Syntax extends Base {}
export class Type extends Base {}

export type CompilerError = Reference | Syntax | Type
