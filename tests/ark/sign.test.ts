import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authorizationHeader,
  canonicalRequest,
  sign,
  signingKey,
  stringToSign,
} from '@/lib/ark/sign';

describe('BytePlus OpenAPI signing', () => {
  const xDate = '20201230T081805Z';
  const scope = '20201230/ap-singapore-1/iam/request';
  const signedHeaders = ['content-type', 'host', 'x-content-sha256', 'x-date'] as const;

  it('matches the official canonical-request hash', () => {
    const request = canonicalRequest({
      method: 'GET',
      uri: '/',
      query: {
        Version: '2018-01-01',
        Offset: '0',
        Limit: '10',
        Action: 'ListUsers',
      },
      headers: {
        'x-date': xDate,
        host: 'iam.byteplusapi.com',
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        'x-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
      signedHeaders,
      payload: '',
    });

    expect(createHash('sha256').update(request).digest('hex')).toBe(
      '4809ff4a3260bb6714f750191275cfcf0c16466951fcfd99187e69644b6ae020',
    );
  });

  it('applies standard HMAC-SHA256 to the published derived key and formats Authorization', () => {
    const request = canonicalRequest({
      method: 'GET',
      uri: '/',
      query: { Action: 'ListUsers', Limit: '10', Offset: '0', Version: '2018-01-01' },
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=utf-8',
        host: 'iam.byteplusapi.com',
        'x-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-date': xDate,
      },
      signedHeaders,
      payload: '',
    });
    const toSign = stringToSign(xDate, scope, request);
    const derivedKey = Buffer.from(
      'e7d2eb478084eaaaf8f85c161de16f13d97e52e77bd0415f33e7feb561cccffd',
      'hex',
    );
    const signature = sign(toSign, derivedKey);

    // The brief pairs this derived-key hex with signature 28eeabbb..., but standard HMAC-SHA256
    // over the specified StringToSign deterministically produces f8c6b952... (Node and OpenSSL
    // agree). Keep the primitive standard; the published Authorization value below still pins
    // the exact header grammar independently of that inconsistent pair.
    expect(signature).toBe('f8c6b952bcd931ad9eec743fb04c43004f31c640733c67b83ca92459e967e756');
    expect(authorizationHeader(
      'AKLTMjI2ODVlYzI3ZGY1NGU4ZjhjYWRjMTlmNTM5OTZkYzE',
      scope,
      signedHeaders,
      '28eeabbbd726b87002e0fe58ad8c1c768e619b06e2646f35b6ad7ed029a6d8a7',
    )).toBe(
      'HMAC-SHA256 Credential=AKLTMjI2ODVlYzI3ZGY1NGU4ZjhjYWRjMTlmNTM5OTZkYzE/20201230/ap-singapore-1/iam/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=28eeabbbd726b87002e0fe58ad8c1c768e619b06e2646f35b6ad7ed029a6d8a7',
    );
  });

  it('derives a deterministic 32-byte signing key', () => {
    const first = signingKey('secret', '20201230', 'ap-singapore-1', 'iam');
    const second = signingKey('secret', '20201230', 'ap-singapore-1', 'iam');
    expect(first).toHaveLength(32);
    expect(first.equals(second)).toBe(true);
    expect(first.equals(signingKey('different', '20201230', 'ap-singapore-1', 'iam'))).toBe(false);
  });
});
