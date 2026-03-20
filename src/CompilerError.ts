import * as Source from "./Source.js"

function calculateLineAndCharacter(
  source: Source.Source,
  index: number
): { line: number; character: number } {
  const limit = Math.max(0, Math.min(index, source.content.length))

  let line = 1
  let character = 1

  for (let i = 0; i < limit; i++) {
    const c = source.content[i]

    if (c == "\n") {
      line += 1
      character = 1
    } else if (c == "\r") {
      if (source.content[i + 1] == "\n" && i + 1 < limit) {
        i += 1
      }

      line += 1
      character = 1
    } else {
      character += 1
    }
  }

  return { line, character }
}

class Base extends Error {
  /**
   * Unformatted message
   */
  readonly origMessage: string

  readonly sourceSpan: Source.Span

  constructor(sourceSpan: Source.Span, message: string) {
    const { line, character } = calculateLineAndCharacter(
      sourceSpan.source,
      sourceSpan.start
    )

    super(`${sourceSpan.source.name}:${line}:${character}: ${message}`)

    this.origMessage = message
    this.sourceSpan = sourceSpan
  }
}

export class Reference extends Base {}
export class Syntax extends Base {}
export class Type extends Base {}

export type CompilerError = Reference | Syntax | Type
