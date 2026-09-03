import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ARK_DEFAULT_OPENAPI_HOST,
  ArkOpenApiError,
  arkAssetsConfigFromEnv,
  createArkAssetsClient,
  parseLivenessCallback,
  withH5Language,
  type ArkAssetsConfig,
} from '@/lib/ark/assets';

type Call = { url: string; init: RequestInit };

function envelope(action: string, result: unknown, error?: { Code: string; Message: string }) {
  return {
    ResponseMetadata: {
      RequestId: `req-${action}`,
      Action: action,
      Version: '2024-01-01',
      Service: 'ark',
      Region: 'ap-southeast-1',
      ...(error ? { Error: error } : {}),
    },
    Result: result,
  };
}

function fakeFetch(handler: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(url), init: init ?? {} };
    calls.push(call);
    const { status = 200, body } = handler(call);
    return new Response(body === null ? '' : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const config: ArkAssetsConfig = {
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  region: 'ap-southeast-1',
  host: ARK_DEFAULT_OPENAPI_HOST,
  projectName: 'portrait-project',
};
const now = () => new Date('2026-09-03T04:05:06.000Z');

function actionOf(call: Call): string {
  return new URL(call.url).searchParams.get('Action') ?? '';
}

describe('assets configuration', () => {
  it('requires non-blank AK and SK and never reads browser-visible keys', () => {
    expect(arkAssetsConfigFromEnv({})).toBeNull();
    expect(arkAssetsConfigFromEnv({ ARK_ACCESS_KEY: 'ak', ARK_SECRET_KEY: '  ' })).toBeNull();
    expect(arkAssetsConfigFromEnv({ ARK_ACCESS_KEY: ' ', ARK_SECRET_KEY: 'sk' })).toBeNull();
    expect(
      arkAssetsConfigFromEnv({ NEXT_PUBLIC_ARK_ACCESS_KEY: 'ak', NEXT_PUBLIC_ARK_SECRET_KEY: 'sk' }),
    ).toBeNull();
  });

  it('applies documented defaults and trims configured values', () => {
    expect(arkAssetsConfigFromEnv({ ARK_ACCESS_KEY: ' ak ', ARK_SECRET_KEY: ' sk ' })).toEqual({
      accessKey: 'ak',
      secretKey: 'sk',
      region: 'ap-southeast-1',
      host: 'ark.ap-southeast-1.byteplusapi.com',
      projectName: 'default',
    });
    expect(
      arkAssetsConfigFromEnv({
        ARK_ACCESS_KEY: 'ak',
        ARK_SECRET_KEY: 'sk',
        ARK_OPENAPI_HOST: 'openapi.example.test',
        ARK_PROJECT_NAME: ' portraits ',
      }),
    ).toMatchObject({ host: 'openapi.example.test', projectName: 'portraits' });
  });
});

describe('signed transport and action mapping', () => {
  it('POSTs the canonical action URL, signed headers, and liveness body', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => ({
      body: envelope(actionOf(call), {
        BytedToken: 'token-1',
        H5Link: 'https://verify.example/session?foo=1',
        CallbackURL: 'https://app.example/callback',
      }),
    }));
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });

    await expect(
      client.createVisualValidateSession({ callbackUrl: 'https://app.example/callback' }),
    ).resolves.toEqual({
      bytedToken: 'token-1',
      h5Link: 'https://verify.example/session?foo=1',
      callbackUrl: 'https://app.example/callback',
    });

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe(
      'https://ark.ap-southeast-1.byteplusapi.com/?Action=CreateVisualValidateSession&Version=2024-01-01',
    );
    expect(call.init.method).toBe('POST');
    const body = String(call.init.body);
    expect(JSON.parse(body)).toEqual({
      CallbackURL: 'https://app.example/callback',
      ProjectName: 'portrait-project',
    });
    const headers = call.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Host).toBe('ark.ap-southeast-1.byteplusapi.com');
    expect(headers['X-Date']).toBe('20260903T040506Z');
    expect(headers['X-Content-Sha256']).toBe(createHash('sha256').update(body).digest('hex'));
    expect(headers.Authorization).toMatch(
      /^HMAC-SHA256 Credential=test-access-key\/20260903\/ap-southeast-1\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=[a-f0-9]{64}$/,
    );
  });

  it('maps liveness result, create/get asset, and sends ProjectName on every call', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      switch (actionOf(call)) {
        case 'GetVisualValidateResult':
          return { body: envelope(actionOf(call), { GroupId: 'group-1' }) };
        case 'CreateAsset':
          return { body: envelope(actionOf(call), { Id: 'asset-1' }) };
        case 'GetAsset':
          return {
            body: envelope(actionOf(call), {
              Id: 'asset-1',
              GroupId: 'group-1',
              Status: 'Active',
              AssetType: 'Image',
              Name: '',
              URL: 'asset://asset-1',
              CreateTime: '2026-09-01T00:00:00Z',
              UpdateTime: '2026-09-01T00:01:00Z',
              LastInferenceTime: '2026-09-02T00:00:00Z',
              ProjectName: 'portrait-project',
              Moderation: { Strategy: 'Default' },
            }),
          };
        default:
          throw new Error(`unexpected action ${actionOf(call)}`);
      }
    });
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });

    await expect(client.getVisualValidateResult('token-1')).resolves.toEqual({ groupId: 'group-1' });
    await expect(
      client.createAsset({
        groupId: 'group-1',
        url: 'https://cdn.example/portrait.jpg',
        assetType: 'Image',
        name: 'front portrait',
        moderation: { strategy: 'Default' },
      }),
    ).resolves.toEqual({ id: 'asset-1' });
    await expect(client.getAsset('asset-1')).resolves.toMatchObject({
      id: 'asset-1',
      groupId: 'group-1',
      status: 'Active',
      name: '',
      lastInferenceAt: '2026-09-02T00:00:00Z',
      moderation: { strategy: 'Default' },
    });

    expect(calls.map((call) => JSON.parse(String(call.init.body)))).toEqual([
      { BytedToken: 'token-1', ProjectName: 'portrait-project' },
      {
        GroupId: 'group-1',
        URL: 'https://cdn.example/portrait.jpg',
        AssetType: 'Image',
        Name: 'front portrait',
        Moderation: { Strategy: 'Default' },
        ProjectName: 'portrait-project',
      },
      { Id: 'asset-1', ProjectName: 'portrait-project' },
    ]);
  });

  it('maps envelope errors with request id and marks API rate-limit codes retryable', async () => {
    const { fetchImpl } = fakeFetch((call) => ({
      body: envelope(actionOf(call), {}, { Code: 'RequestLimitExceeded', Message: 'slow down' }),
    }));
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });
    await expect(client.getAsset('asset-1')).rejects.toMatchObject({
      name: 'ArkOpenApiError',
      code: 'RequestLimitExceeded',
      message: 'slow down',
      requestId: 'req-GetAsset',
      httpStatus: 200,
      retryable: true,
    });
  });

  it('maps HTTP 429 without a metadata error as retryable', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 429, body: { message: 'too many requests' } }));
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });
    const promise = client.deleteAsset('asset-1');
    await expect(promise).rejects.toBeInstanceOf(ArkOpenApiError);
    await expect(promise).rejects.toMatchObject({ code: 'http_429', httpStatus: 429, retryable: true });
  });
});

describe('inventory operations', () => {
  it('drains ListAssets pages, forces LivenessFace, and maps reclaim records', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const request = JSON.parse(String(call.init.body));
      if (request.NextToken === 'page-2') {
        return {
          body: envelope('ListAssets', {
            Items: [
              {
                Id: 'asset-2',
                GroupId: 'group-2',
                Status: 'Failed',
                CreateTime: '2026-08-02T00:00:00Z',
              },
            ],
          }),
        };
      }
      return {
        body: envelope('ListAssets', {
          Items: [
            {
              Id: 'asset-1',
              GroupId: 'group-1',
              Status: 'Active',
              CreateTime: '2026-08-01T00:00:00Z',
              LastInferenceTime: '2026-09-01T00:00:00Z',
            },
          ],
          NextToken: 'page-2',
        }),
      };
    });
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });

    await expect(client.listAssets({ groupIds: ['group-1'], statuses: ['Active', 'Failed'] })).resolves.toEqual([
      {
        id: 'asset-1',
        groupId: 'group-1',
        status: 'Active',
        createdAt: '2026-08-01T00:00:00Z',
        lastInferenceAt: '2026-09-01T00:00:00Z',
      },
      {
        id: 'asset-2',
        groupId: 'group-2',
        status: 'Failed',
        createdAt: '2026-08-02T00:00:00Z',
        lastInferenceAt: null,
      },
    ]);
    expect(calls.map((call) => JSON.parse(String(call.init.body)))).toEqual([
      {
        Filter: { GroupType: 'LivenessFace', GroupIds: ['group-1'], Statuses: ['Active', 'Failed'] },
        MaxResults: 100,
        ProjectName: 'portrait-project',
      },
      {
        Filter: { GroupType: 'LivenessFace', GroupIds: ['group-1'], Statuses: ['Active', 'Failed'] },
        MaxResults: 100,
        NextToken: 'page-2',
        ProjectName: 'portrait-project',
      },
    ]);
  });

  it('drains asset groups and maps delete calls to empty results', async () => {
    const { fetchImpl, calls } = fakeFetch((call) => {
      const action = actionOf(call);
      const request = JSON.parse(String(call.init.body));
      if (action === 'ListAssetGroups') {
        return {
          body: envelope(action, {
            Items: request.NextToken
              ? [{ Id: 'group-2', Name: 'B', Description: '', GroupType: 'LivenessFace', ProjectName: 'portrait-project', CreateTime: 'c2', UpdateTime: 'u2' }]
              : [{ Id: 'group-1', Name: 'A', Description: 'first', GroupType: 'LivenessFace', ProjectName: 'portrait-project', CreateTime: 'c1', UpdateTime: 'u1' }],
            ...(request.NextToken ? {} : { NextToken: 'next' }),
          }),
        };
      }
      return { body: envelope(action, {}) };
    });
    const client = createArkAssetsClient(config, { fetch: fetchImpl, now });

    const groups = await client.listAssetGroups();
    expect(groups.map((group) => group.id)).toEqual(['group-1', 'group-2']);
    await expect(client.deleteAsset('asset-1')).resolves.toBeUndefined();
    await expect(client.deleteAssetGroup('group-1')).resolves.toBeUndefined();
    expect(calls.slice(-2).map((call) => [actionOf(call), JSON.parse(String(call.init.body))])).toEqual([
      ['DeleteAsset', { Id: 'asset-1', ProjectName: 'portrait-project' }],
      ['DeleteAssetGroup', { Id: 'group-1', ProjectName: 'portrait-project' }],
    ]);
  });
});

describe('liveness URL helpers', () => {
  it('sets or overrides the H5 language without losing other query parameters', () => {
    expect(withH5Language('https://verify.example/start?token=abc&lng=zh#step', 'en')).toBe(
      'https://verify.example/start?token=abc&lng=en#step',
    );
  });

  it('parses success and failure callbacks from URLs and URLSearchParams', () => {
    expect(
      parseLivenessCallback(
        'https://app.example/callback?bytedToken=t-1&resultCode=10000&algorithmBaseRespCode=0&verify_type=real_time',
      ),
    ).toEqual({ bytedToken: 't-1', ok: true, resultCode: '10000', algorithmBaseRespCode: '0' });
    expect(parseLivenessCallback(new URLSearchParams('bytedToken=t-2&resultCode=10001'))).toEqual({
      bytedToken: 't-2',
      ok: false,
      resultCode: '10001',
      algorithmBaseRespCode: null,
    });
  });
});
