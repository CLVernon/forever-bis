// Shareable read-only links: the character (plus the phase definitions) is
// serialized, deflate-compressed where the browser supports it, and packed
// into the URL hash — no server involved.

function b64urlEncode(u8) {
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** Object -> hash payload string ("c<base64url>" compressed, "r…" raw). */
export async function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'function') {
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return 'c' + b64urlEncode(buf);
  }
  return 'r' + b64urlEncode(bytes);
}

/** Hash payload string -> object. Throws on malformed input. */
export async function decodeShare(str) {
  const kind = str[0];
  const bytes = b64urlDecode(str.slice(1));
  let json;
  if (kind === 'c') {
    const stream = new Blob([bytes]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    json = await new Response(stream).text();
  } else if (kind === 'r') {
    json = new TextDecoder().decode(bytes);
  } else {
    throw new Error('Unknown share format');
  }
  return JSON.parse(json);
}
