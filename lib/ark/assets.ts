import {
  ARK_SIGNED_HEADERS,
  authorizationHeader,
  canonicalRequest,
  sha256Hex,
  sign,
  signingKey,
  stringToSign,
} from './sign';

/**
 * BytePlus ModelArk's private real-human asset library.
 *
 * Unlike the video-task API in `client.ts`, this boundary uses an AK/SK pair and BytePlus
 * HMAC-SHA256 request signing. Fetch and the clock are dependencies so tests can prove every byte
 * of a request without credentials or a live call.
 */

export const ARK_DEFAULT_OPENAPI_HOST = 'ark.ap-southeast-1.byteplusapi.com';
export const ARK_OPENAPI_VERSION = '2024-01-01';
export const ARK_OPENAPI_SERVICE = 'ark';
export const ARK_DEFAULT_REGION = 'ap-southeast-1';

export interface ArkAssetsConfig {
  accessKey: string;
  secretKey: string;
  region: string;
  host: string;
  projectName: string;
}

/** `null` unless both server-only credentials are configured. */
export function arkAssetsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ArkAssetsConfig | null {
  const accessKey = env.ARK_ACCESS_KEY?.trim();
  const secretKey = env.ARK_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) return null;
  return {
    accessKey,
    secretKey,
    region: ARK_DEFAULT_REGION,
    host: env.ARK_OPENAPI_HOST?.trim() || ARK_DEFAULT_OPENAPI_HOST,
    projectName: env.ARK_PROJECT_NAME?.trim() || 'default',
  };
}

export type ArkAssetStatus = 'Processing' | 'Active' | 'Failed';
export type ArkAssetType = 'Image' | 'Video' | 'Audio';
export type ArkModerationStrategy = 'Default' | 'Skip';

export interface ArkAssetRecord {
  id: string;
  groupId: string;
  status: ArkAssetStatus;
  createdAt: string;
  /**
   * The API omits this for assets unused since 2026-07-24, so reclaim must not treat it as the
   * sole evidence of disuse.
   */
  lastInferenceAt: string | null;
}

export interface ArkAsset extends ArkAssetRecord {
  assetType: ArkAssetType;
  name: string;
  url: string;
  updatedAt: string;
  projectName: string;
  moderation: { strategy: ArkModerationStrategy };
}

export interface ArkAssetGroupRecord {
  id: string;
  name: string;
  description: string;
  groupType: 'LivenessFace';
  projectName: string;
  createdAt: string;
  updatedAt: string;
}

export interface ArkAssetsApi {
  listAssets(filter: { groupIds?: string[]; statuses?: ArkAssetStatus[] }): Promise<ArkAssetRecord[]>;
  /** Irreversible. */
  deleteAsset(id: string): Promise<void>;
  /** Irreversible; the person must pass liveness again to come back. */
  deleteAssetGroup(id: string): Promise<void>;
}

export interface CreateVisualValidateSessionInput {
  callbackUrl: string;
  projectName?: string;
}

export interface CreateVisualValidateSessionResult {
  bytedToken: string;
  h5Link: string;
  callbackUrl: string;
}

export interface GetVisualValidateResultInput {
  bytedToken: string;
  projectName?: string;
}

export interface CreateAssetInput {
  groupId: string;
  url: string;
  assetType: ArkAssetType;
  name?: string;
  moderation?: { strategy: ArkModerationStrategy };
  projectName?: string;
}

export interface GetAssetInput {
  id: string;
  projectName?: string;
}

export interface ListAssetGroupsInput {
  groupIds?: string[];
  name?: string;
  maxResults?: number;
  sortBy?: 'CreateTime';
  sortOrder?: 'Asc' | 'Desc';
}

export interface ArkAssetsClient extends ArkAssetsApi {
  createVisualValidateSession(
    input: CreateVisualValidateSessionInput,
  ): Promise<CreateVisualValidateSessionResult>;
  getVisualValidateResult(input: string | GetVisualValidateResultInput): Promise<{ groupId: string }>;
  createAsset(input: CreateAssetInput): Promise<{ id: string }>;
  getAsset(input: string | GetAssetInput): Promise<ArkAsset>;
  listAssetGroups(input?: ListAssetGroupsInput): Promise<ArkAssetGroupRecord[]>;
}

export interface ArkAssetsClientDeps {
  fetch?: typeof fetch;
  now?: () => Date;
}

export interface ArkSignedRequest {
  url: string;
  init: RequestInit;
}

type ArkAction =
  | 'CreateVisualValidateSession'
  | 'GetVisualValidateResult'
  | 'CreateAsset'
  | 'GetAsset'
  | 'ListAssets'
  | 'ListAssetGroups'
  | 'DeleteAsset'
  | 'DeleteAssetGroup';

/** Pure request construction, also used by the smoke command's non-networking `--dry` mode. */
export function buildArkOpenApiRequest(
  config: ArkAssetsConfig,
  action: ArkAction,
  bodyValue: Readonly<Record<string, unknown>>,
  now: Date,
): ArkSignedRequest {
  const body = JSON.stringify(bodyValue);
  const xDate = formatXDate(now);
  const date = xDate.slice(0, 8);
  const credentialScope = `${date}/${config.region}/${ARK_OPENAPI_SERVICE}/request`;
  const query = { Action: action, Version: ARK_OPENAPI_VERSION };
  const headers = {
    'Content-Type': 'application/json',
    Host: config.host,
    'X-Content-Sha256': sha256Hex(body),
    'X-Date': xDate,
  };
  const request = canonicalRequest({
    method: 'POST',
    uri: '/',
    query,
    headers,
    signedHeaders: ARK_SIGNED_HEADERS,
    payload: body,
  });
  const signature = sign(
    stringToSign(xDate, credentialScope, request),
    signingKey(config.secretKey, date, config.region, ARK_OPENAPI_SERVICE),
  );
  const authorization = authorizationHeader(
    config.accessKey,
    credentialScope,
    ARK_SIGNED_HEADERS,
    signature,
  );
  const queryString = `Action=${encodeURIComponent(action)}&Version=${encodeURIComponent(ARK_OPENAPI_VERSION)}`;

  return {
    url: `https://${config.host}/?${queryString}`,
    init: {
      method: 'POST',
      headers: { ...headers, Authorization: authorization },
      body,
    },
  };
}

export class ArkOpenApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly httpStatus: number;
  readonly retryable: boolean;

  constructor(
    code: string,
    message: string,
    requestId: string | null,
    httpStatus: number,
    retryable = isRetryable(code, httpStatus),
  ) {
    super(message);
    this.name = 'ArkOpenApiError';
    this.code = code;
    this.requestId = requestId;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function createArkAssetsClient(
  config: ArkAssetsConfig,
  deps: ArkAssetsClientDeps = {},
): ArkAssetsClient {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const now = deps.now ?? (() => new Date());

  async function call(action: ArkAction, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const request = buildArkOpenApiRequest(config, action, body, now());
    let response: Response;
    try {
      response = await doFetch(request.url, request.init);
    } catch (cause) {
      throw new ArkOpenApiError(
        'ark_openapi_network',
        cause instanceof Error ? cause.message : 'network error',
        null,
        0,
        true,
      );
    }

    const responseText = await response.text();
    let json: unknown = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {
      json = null;
    }
    const envelope = asRecord(json);
    const metadata = asRecord(envelope.ResponseMetadata);
    const requestId = stringOrNull(metadata.RequestId);
    const hasEnvelopeError =
      Object.prototype.hasOwnProperty.call(metadata, 'Error') && metadata.Error !== null;
    const apiError = asRecord(metadata.Error);

    if (!response.ok || hasEnvelopeError) {
      const code = nonEmptyString(apiError.Code) ?? `http_${response.status}`;
      const message =
        nonEmptyString(apiError.Message) ??
        nonEmptyString(envelope.message) ??
        (responseText.slice(0, 200) || response.statusText || 'ModelArk OpenAPI request failed');
      throw new ArkOpenApiError(code, message, requestId, response.status);
    }

    if (!Object.prototype.hasOwnProperty.call(envelope, 'Result')) {
      throw new ArkOpenApiError(
        'ark_openapi_malformed',
        'response envelope has no Result',
        requestId,
        response.status,
        false,
      );
    }
    return asRecord(envelope.Result);
  }

  return {
    async createVisualValidateSession(input) {
      const result = await call('CreateVisualValidateSession', {
        CallbackURL: input.callbackUrl,
        ProjectName: input.projectName ?? config.projectName,
      });
      return {
        bytedToken: requiredString(result.BytedToken, 'CreateVisualValidateSession.BytedToken'),
        h5Link: requiredString(result.H5Link, 'CreateVisualValidateSession.H5Link'),
        callbackUrl: requiredString(result.CallbackURL, 'CreateVisualValidateSession.CallbackURL'),
      };
    },

    async getVisualValidateResult(input) {
      const normalized = typeof input === 'string' ? { bytedToken: input } : input;
      const result = await call('GetVisualValidateResult', {
        BytedToken: normalized.bytedToken,
        ProjectName: normalized.projectName ?? config.projectName,
      });
      return { groupId: requiredString(result.GroupId, 'GetVisualValidateResult.GroupId') };
    },

    async createAsset(input) {
      const body: Record<string, unknown> = {
        GroupId: input.groupId,
        URL: input.url,
        AssetType: input.assetType,
      };
      if (input.name !== undefined) body.Name = input.name;
      if (input.moderation !== undefined) body.Moderation = { Strategy: input.moderation.strategy };
      body.ProjectName = input.projectName ?? config.projectName;
      const result = await call('CreateAsset', body);
      return { id: requiredString(result.Id, 'CreateAsset.Id') };
    },

    async getAsset(input) {
      const normalized = typeof input === 'string' ? { id: input } : input;
      const result = await call('GetAsset', {
        Id: normalized.id,
        ProjectName: normalized.projectName ?? config.projectName,
      });
      return mapAsset(result);
    },

    async listAssets(filter) {
      const items: ArkAssetRecord[] = [];
      let nextToken: string | undefined;
      const seenTokens = new Set<string>();
      do {
        const wireFilter: Record<string, unknown> = { GroupType: 'LivenessFace' };
        if (filter.groupIds !== undefined) wireFilter.GroupIds = filter.groupIds;
        if (filter.statuses !== undefined) wireFilter.Statuses = filter.statuses;
        const body: Record<string, unknown> = {
          Filter: wireFilter,
          MaxResults: 100,
          ProjectName: config.projectName,
        };
        if (nextToken !== undefined) body.NextToken = nextToken;
        const result = await call('ListAssets', body);
        items.push(...arrayOfRecords(result.Items).map(mapAssetRecord));
        nextToken = nonEmptyString(result.NextToken) ?? undefined;
        assertFreshNextToken(nextToken, seenTokens);
      } while (nextToken !== undefined);
      return items;
    },

    async listAssetGroups(input = {}) {
      const items: ArkAssetGroupRecord[] = [];
      let nextToken: string | undefined;
      const seenTokens = new Set<string>();
      const maxResults = clampMaxResults(input.maxResults);
      do {
        const wireFilter: Record<string, unknown> = { GroupType: 'LivenessFace' };
        if (input.groupIds !== undefined) wireFilter.GroupIds = input.groupIds;
        if (input.name !== undefined) wireFilter.Name = input.name;
        const body: Record<string, unknown> = {
          Filter: wireFilter,
          MaxResults: maxResults,
          ProjectName: config.projectName,
        };
        if (nextToken !== undefined) body.NextToken = nextToken;
        if (input.sortBy !== undefined) body.SortBy = input.sortBy;
        if (input.sortOrder !== undefined) body.SortOrder = input.sortOrder;
        const result = await call('ListAssetGroups', body);
        items.push(...arrayOfRecords(result.Items).map(mapAssetGroup));
        nextToken = nonEmptyString(result.NextToken) ?? undefined;
        assertFreshNextToken(nextToken, seenTokens);
      } while (nextToken !== undefined);
      return items;
    },

    async deleteAsset(id) {
      await call('DeleteAsset', { Id: id, ProjectName: config.projectName });
    },

    async deleteAssetGroup(id) {
      await call('DeleteAssetGroup', { Id: id, ProjectName: config.projectName });
    },
  };
}

export type ArkH5Language = 'zh' | 'en' | 'zh-Hant';

export function withH5Language(h5Link: string, language: ArkH5Language): string {
  const url = new URL(h5Link);
  url.searchParams.set('lng', language);
  return url.toString();
}

export interface ArkLivenessCallback {
  bytedToken: string | null;
  ok: boolean;
  resultCode: string | null;
  algorithmBaseRespCode: string | null;
}

export function parseLivenessCallback(input: string | URLSearchParams): ArkLivenessCallback {
  const params =
    input instanceof URLSearchParams
      ? input
      : input.startsWith('?') || (!input.includes('://') && input.includes('='))
        ? new URLSearchParams(input)
        : new URL(input).searchParams;
  const resultCode = params.get('resultCode');
  return {
    bytedToken: params.get('bytedToken'),
    ok: resultCode === '10000',
    resultCode,
    algorithmBaseRespCode: params.get('algorithmBaseRespCode'),
  };
}

export interface ArkQuota {
  groups: number;
  assets: number;
}

/** Advanced Creation Rights - Entry (free). */
export const ARK_ENTRY_QUOTA: ArkQuota = { groups: 50, assets: 50 };

/** Advanced Creation Rights - paid tier. */
export const ARK_ADVANCED_QUOTA: ArkQuota = { groups: 1_000_000, assets: 1_000_000 };

/** `ARK_QUOTA_GROUPS` / `ARK_QUOTA_ASSETS` override the tier the account is actually on. */
export function arkQuotaFromEnv(env: Record<string, string | undefined> = process.env): ArkQuota {
  const groups = Number.parseInt(env.ARK_QUOTA_GROUPS ?? '', 10);
  const assets = Number.parseInt(env.ARK_QUOTA_ASSETS ?? '', 10);
  return {
    groups: Number.isFinite(groups) && groups > 0 ? groups : ARK_ENTRY_QUOTA.groups,
    assets: Number.isFinite(assets) && assets > 0 ? assets : ARK_ENTRY_QUOTA.assets,
  };
}

function formatXDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function isRetryable(code: string, status: number): boolean {
  return status === 429 || status >= 500 || /rate.?limit|requestlimit|throttl|too.?many/i.test(code);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requiredString(value: unknown, field: string): string {
  const parsed = nonEmptyString(value);
  if (parsed !== null) return parsed;
  throw new ArkOpenApiError('ark_openapi_malformed', `${field} is missing`, null, 0, false);
}

function assetStatus(value: unknown): ArkAssetStatus {
  if (value === 'Processing' || value === 'Active' || value === 'Failed') return value;
  throw new ArkOpenApiError('ark_openapi_malformed', 'asset status is invalid', null, 0, false);
}

function assetType(value: unknown): ArkAssetType {
  if (value === 'Image' || value === 'Video' || value === 'Audio') return value;
  throw new ArkOpenApiError('ark_openapi_malformed', 'asset type is invalid', null, 0, false);
}

function moderationStrategy(value: unknown): ArkModerationStrategy {
  if (value === 'Default' || value === 'Skip') return value;
  throw new ArkOpenApiError('ark_openapi_malformed', 'moderation strategy is invalid', null, 0, false);
}

function mapAssetRecord(item: Record<string, unknown>): ArkAssetRecord {
  return {
    id: requiredString(item.Id, 'asset.Id'),
    groupId: requiredString(item.GroupId, 'asset.GroupId'),
    status: assetStatus(item.Status),
    createdAt: requiredString(item.CreateTime, 'asset.CreateTime'),
    lastInferenceAt: stringOrNull(item.LastInferenceTime),
  };
}

function mapAsset(item: Record<string, unknown>): ArkAsset {
  return {
    ...mapAssetRecord(item),
    assetType: assetType(item.AssetType),
    name: requiredString(item.Name, 'asset.Name'),
    url: requiredString(item.URL, 'asset.URL'),
    updatedAt: requiredString(item.UpdateTime, 'asset.UpdateTime'),
    projectName: requiredString(item.ProjectName, 'asset.ProjectName'),
    moderation: { strategy: moderationStrategy(asRecord(item.Moderation).Strategy) },
  };
}

function mapAssetGroup(item: Record<string, unknown>): ArkAssetGroupRecord {
  if (item.GroupType !== 'LivenessFace') {
    throw new ArkOpenApiError('ark_openapi_malformed', 'asset group type is invalid', null, 0, false);
  }
  return {
    id: requiredString(item.Id, 'assetGroup.Id'),
    name: requiredString(item.Name, 'assetGroup.Name'),
    description: stringOrNull(item.Description) ?? '',
    groupType: 'LivenessFace',
    projectName: requiredString(item.ProjectName, 'assetGroup.ProjectName'),
    createdAt: requiredString(item.CreateTime, 'assetGroup.CreateTime'),
    updatedAt: requiredString(item.UpdateTime, 'assetGroup.UpdateTime'),
  };
}

function clampMaxResults(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 100;
  return Math.min(100, Math.max(1, Math.trunc(value)));
}

function assertFreshNextToken(nextToken: string | undefined, seenTokens: Set<string>): void {
  if (nextToken === undefined) return;
  if (seenTokens.has(nextToken)) {
    throw new ArkOpenApiError(
      'ark_openapi_pagination_loop',
      'List response repeated a NextToken',
      null,
      0,
      false,
    );
  }
  seenTokens.add(nextToken);
}
