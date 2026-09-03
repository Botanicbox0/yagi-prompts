import { createHash, createHmac } from 'node:crypto';

export const ARK_SIGNED_HEADERS = ['content-type', 'host', 'x-content-sha256', 'x-date'] as const;

export interface CanonicalRequestInput {
  method: string;
  uri: string;
  query: Readonly<Record<string, string>>;
  headers: Readonly<Record<string, string>>;
  signedHeaders?: readonly string[];
  payload: string | Uint8Array;
}

/** BytePlus uses RFC3986 encoding, whose escaped set is slightly stricter than encodeURIComponent. */
export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonicalRequest(input: CanonicalRequestInput): string {
  const signedHeaders = (input.signedHeaders ?? Object.keys(input.headers))
    .map((name) => name.toLowerCase())
    .sort(asciiCompare);
  const headerValues = new Map(
    Object.entries(input.headers).map(([name, value]) => [name.toLowerCase(), value] as const),
  );
  const canonicalHeaders = signedHeaders
    .map((name) => {
      const value = headerValues.get(name);
      if (value === undefined) throw new TypeError(`missing signed header: ${name}`);
      return `${name}:${value.trim()}\n`;
    })
    .join('');
  const canonicalQuery = Object.entries(input.query)
    .sort(([left], [right]) => asciiCompare(left, right))
    .map(([key, value]) => `${rfc3986(key)}=${rfc3986(value)}`)
    .join('&');

  return [
    input.method.toUpperCase(),
    input.uri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders.join(';'),
    sha256Hex(input.payload),
  ].join('\n');
}

export function stringToSign(xDate: string, credentialScope: string, request: string): string {
  return ['HMAC-SHA256', xDate, credentialScope, sha256Hex(request)].join('\n');
}

function hmac(key: string | Uint8Array, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function signingKey(secretKey: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac(secretKey, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'request');
}

export function sign(value: string, key: Uint8Array): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function authorizationHeader(
  accessKey: string,
  credentialScope: string,
  signedHeaders: readonly string[],
  signature: string,
): string {
  const names = signedHeaders.map((name) => name.toLowerCase()).sort(asciiCompare).join(';');
  return (
    `HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${names}, Signature=${signature}`
  );
}

function asciiCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
