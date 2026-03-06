export interface Source {
  name: string
  content: string
}

export interface CompileOptions {}

export interface UplcScript {
  version: 3
  root: Uint8Array
  verbose: Uint8Array
}

export const compile = (
  src: string | Source | string[] | Source[],
  options: CompileOptions = {}
): Record<string, UplcScript> => {
  const srcs: Source[] = Array.isArray(src)
    ? src.map((s) => (typeof s == "string" ? { name: "", content: s } : s))
    : [typeof src == "string" ? { name: "", content: src } : src]

  console.log("Compiling:", srcs)

  return {}
}
