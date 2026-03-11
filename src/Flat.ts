export interface Writer {
  writeBool(b: boolean): Writer
  writeBytes(bytes: readonly number[] | Uint8Array): Writer
  writeInt(x: bigint | number): Writer
  writeListCons(): Writer
  writeListNil(): Writer
  writeTermTag(tag: number): Writer
  writeTypeBits(typeBits: string): Writer
  writeBuiltinId(id: number): Writer
  finalize(): number[]
}

export function makeWriter(): Writer {
  return new WriterImpl()
}

class WriterImpl implements Writer {
  private readonly parts: string[] = []
  private n = 0

  writeBool(b: boolean): Writer {
    this.writeBits(b ? "1" : "0")
    return this
  }

  writeBytes(bytes: readonly number[] | Uint8Array): Writer {
    encodeBytes(this, Array.from(bytes))
    return this
  }

  writeInt(x: bigint | number): Writer {
    const value = typeof x == "number" ? BigInt(x) : x

    if (value < 0n) {
      throw new Error("x in writeInt isn't positive")
    }

    encodeInt(this, value)
    return this
  }

  writeListCons(): Writer {
    this.writeBits("1")
    return this
  }

  writeListNil(): Writer {
    this.writeBits("0")
    return this
  }

  writeTermTag(tag: number): Writer {
    this.writeBits(pad(tag.toString(2), 4))
    return this
  }

  writeTypeBits(typeBits: string): Writer {
    this.writeBits(`1${typeBits}0`)
    return this
  }

  writeBuiltinId(id: number): Writer {
    this.writeBits(pad(id.toString(2), 7))
    return this
  }

  finalize(): number[] {
    this.padToByteBoundary(true)

    const chars = this.parts.join("")
    const bytes: number[] = []

    for (let i = 0; i < chars.length; i += 8) {
      bytes.push(parseInt(chars.slice(i, i + 8), 2))
    }

    return bytes
  }

  padToByteBoundary(force: boolean): void {
    let nPad = 0

    if (this.n % 8 != 0) {
      nPad = 8 - (this.n % 8)
    } else if (force) {
      nPad = 8
    }

    if (nPad == 0) {
      return
    }

    const padding = new Array(nPad).fill("0")
    padding[nPad - 1] = "1"

    this.parts.push(padding.join(""))
    this.n += nPad
  }

  writeBits(bitChars: string): void {
    for (const c of bitChars) {
      if (c != "0" && c != "1") {
        throw new Error(`Bit string contains invalid chars: ${bitChars}`)
      }
    }

    this.parts.push(bitChars)
    this.n += bitChars.length
  }
}

function encodeBytes(
  writer: WriterImpl,
  bytes: readonly number[],
  padToBoundary: boolean = true
): void {
  if (padToBoundary) {
    writer.padToByteBoundary(true)
  }

  let pos = 0

  while (pos < bytes.length) {
    const nChunk = Math.min(bytes.length - pos, 255)

    writer.writeBits(pad(nChunk.toString(2), 8))

    for (let i = pos; i < pos + nChunk; i++) {
      const b = bytes[i]

      if (b === undefined || b < 0 || b > 255) {
        throw new Error(`invalid byte ${b}`)
      }

      writer.writeBits(pad(b.toString(2), 8))
    }

    pos += nChunk
  }

  if (padToBoundary) {
    writer.writeBits("00000000")
  }
}

export function intSize(x: bigint | number, signed: boolean = true): number {
  let value = typeof x == "number" ? BigInt(x) : x

  if (signed) {
    value = zigZagToUnsigned(value)
  }

  return 4 + Math.ceil(value.toString(2).length / 7) * 8
}

function encodeInt(writer: WriterImpl, x: bigint): void {
  const bitString = pad(x.toString(2), 7)
  const parts: string[] = []

  for (let i = 0; i < bitString.length; i += 7) {
    parts.push(bitString.slice(i, i + 7))
  }

  parts.reverse()

  for (let i = 0; i < parts.length; i++) {
    writer.writeBits(`${i == parts.length - 1 ? "0" : "1"}${parts[i]}`)
  }
}

export function listSize<T>(
  items: readonly T[],
  itemSize: (item: T) => number
): number {
  return (
    1 + items.length + items.reduce((prev, item) => itemSize(item) + prev, 0)
  )
}

function zigZagToUnsigned(x: bigint): bigint {
  return x < 0n ? -x * 2n - 1n : x * 2n
}

function pad(bits: string, n: number): string {
  if (bits.length == n) {
    return bits
  }

  if (n <= 0) {
    throw new RangeError(`Expected pad length n to be > 0, got n=${n}`)
  }

  if (bits.length % n != 0) {
    bits = new Array(n - (bits.length % n)).fill("0").join("") + bits
  }

  return bits
}
