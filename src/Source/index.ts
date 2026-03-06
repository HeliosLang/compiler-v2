export interface Source {
  readonly name: string
  readonly content: string
}

export interface Span {
  /**
   * Content is wrapped in source to avoid copies of the whole content everywhere
   */
  readonly source: Source

  /**
   * This is the character number
   */
  readonly start: number

  /**
   * This is the character number
   */
  readonly end: number
}

export const DummySpan = (): Span => ({
  source: { name: "", content: "" },
  start: 0,
  end: 0
})

export const isDummySpan = (span: Span) =>
  span.source.content == "" &&
  span.source.name == "" &&
  span.start == 0 &&
  span.end == 0
/**
 * The key is the char index in the new source (which is being mapped to the old source using the Site value)
 */
type Map$ = Map<number, Span>

export type { Map$ as Map }
