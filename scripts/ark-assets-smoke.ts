import { config as loadEnv } from 'dotenv';
import {
  ARK_DEFAULT_OPENAPI_HOST,
  ARK_DEFAULT_REGION,
  ArkOpenApiError,
  arkAssetsConfigFromEnv,
  buildArkOpenApiRequest,
  createArkAssetsClient,
  type ArkAssetsConfig,
} from '@/lib/ark/assets';

/**
 * Read-only connectivity check for the signed ModelArk private asset library.
 *
 * `--dry` constructs one deterministic ListAssetGroups request and prints only its non-secret
 * signed headers. A live run drains ListAssetGroups and ListAssets; it never creates or deletes.
 */

loadEnv({ path: ['.env.local', '.env'], quiet: true });

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function maskAuthorization(value: string): string {
  return value
    .replace(/Credential=[^/]+\//, 'Credential=***/')
    .replace(/Signature=[a-f0-9]+/i, 'Signature=***');
}

function maskId(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function dryConfig(): ArkAssetsConfig {
  // Never derive printable dry-run output from an ARK_* value. Only presence is reportable.
  return {
    accessKey: 'dry-access-key',
    secretKey: 'dry-secret-key',
    region: ARK_DEFAULT_REGION,
    host: ARK_DEFAULT_OPENAPI_HOST,
    projectName: 'default',
  };
}

async function main(): Promise<number> {
  const dry = hasFlag('dry');
  const config = arkAssetsConfigFromEnv();
  console.log(`ARK_ACCESS_KEY present: ${Boolean(process.env.ARK_ACCESS_KEY?.trim())}`);

  if (dry) {
    const request = buildArkOpenApiRequest(
      dryConfig(),
      'ListAssetGroups',
      {
        Filter: { GroupType: 'LivenessFace' },
        MaxResults: 100,
        ProjectName: 'default',
      },
      new Date(),
    );
    const headers = request.init.headers as Record<string, string>;
    console.log('--dry: not calling. Signed request headers (credentials masked):');
    console.log(
      JSON.stringify(
        {
          'Content-Type': headers['Content-Type'],
          Host: headers.Host,
          'X-Content-Sha256': headers['X-Content-Sha256'],
          'X-Date': headers['X-Date'],
          Authorization: maskAuthorization(headers.Authorization ?? ''),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (!config) {
    console.error('ARK_ACCESS_KEY and ARK_SECRET_KEY must both be set in .env.local; nothing called.');
    return 2;
  }

  const client = createArkAssetsClient(config);
  try {
    const groups = await client.listAssetGroups();
    const assets = await client.listAssets({});
    console.log(`asset groups: ${groups.length}`);
    console.log(`assets: ${assets.length}`);
    console.log(`first group ids: ${groups.slice(0, 3).map((group) => maskId(group.id)).join(', ') || '(none)'}`);
    console.log(`first asset ids: ${assets.slice(0, 3).map((asset) => maskId(asset.id)).join(', ') || '(none)'}`);
    return 0;
  } catch (error) {
    if (error instanceof ArkOpenApiError) {
      console.error(
        `ArkOpenApiError ${error.code} (HTTP ${error.httpStatus}, request=${error.requestId ?? '-'}, retryable=${error.retryable}): ${error.message}`,
      );
      return 1;
    }
    console.error(error);
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
