import { parseCliArgs, runRedteam } from './prompt-guard-redteam/runner';

async function main(): Promise<number> {
  const repoRoot = process.cwd();
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2), repoRoot);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 2;
  }

  try {
    const out = await runRedteam(options, { repoRoot });
    if (!out.dryRun && out.interrupted) return 130;
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  },
);
