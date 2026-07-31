const toBase64Url = (bytes) => {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

const fromBase64Url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
}

export function encodePayload(value) {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)))
}

export function decodePayload(value) {
  if (!value) return null
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64Url(value)))
  } catch {
    return null
  }
}

export function readPayloadFromHash(routeName) {
  const match = location.hash.match(new RegExp(`^#/${routeName}(?:\\?|$)`))
  if (!match) return ''
  const query = location.hash.split('?')[1] || ''
  return new URLSearchParams(query).get('payload') || ''
}

export async function writeClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export async function shortenUrl(url) {
  return url
}
