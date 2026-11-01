// バイト列と文字列の変換

export type Bytes = Uint8Array<ArrayBuffer>

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length))
}

export function utf8(text: string): Bytes {
  return new TextEncoder().encode(text)
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 復旧キーの表示に使う Crockford の Base32。読み間違えやすい I・L・O・U を使わない
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function encodeCrockford(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += CROCKFORD[(value << (5 - bits)) & 31]
  return output
}

// 入力のゆれ（小文字・区切りの - や空白・O と 0・I/L と 1）を吸収する。使えない文字があれば null
export function decodeCrockford(text: string): Bytes | null {
  const normalized = text
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of normalized) {
    const index = CROCKFORD.indexOf(char)
    if (index < 0) return null
    value = ((value << 5) | index) & 0xffff
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return new Uint8Array(output)
}

// 4 文字ずつ - で区切る（例: 7K3M-9QXA-…）
export function groupBy4(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? ''
}
