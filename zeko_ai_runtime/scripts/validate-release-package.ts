import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const npmCacheDir = path.join(repoRoot, '.npm-cache-release');

type ExportEntry =
  | string
  | {
      types?: string;
      import?: string;
      default?: string;
    };

interface PackageJsonShape {
  name?: string;
  version?: string;
  private?: boolean;
  license?: string;
  files?: string[];
  exports?: Record<string, ExportEntry>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function normalizePackPath(filePath: string) {
  return filePath.replace(/^package\//, '');
}

async function readPackageJson() {
  const packageJsonPath = path.join(repoRoot, 'package.json');
  return JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as PackageJsonShape;
}

async function validateExports(packageJson: PackageJsonShape) {
  const expectedExports = {
    '.': {
      types: './dist/src/sdk/index.d.ts',
      import: './dist/src/sdk/index.js'
    },
    './sdk': {
      types: './dist/src/sdk/index.d.ts',
      import: './dist/src/sdk/index.js'
    },
    './compat': {
      types: './dist/src/compat/index.d.ts',
      import: './dist/src/compat/index.js'
    },
    './crypto': {
      types: './dist/src/crypto-envelope.d.ts',
      import: './dist/src/crypto-envelope.js'
    },
    './package.json': './package.json'
  } satisfies Record<string, ExportEntry>;

  const packageExports = packageJson.exports || {};
  const checkedPaths = new Set<string>();

  for (const [key, expectedValue] of Object.entries(expectedExports)) {
    const actualValue = packageExports[key];
    assert(actualValue, `Missing package export "${key}".`);
    if (typeof expectedValue === 'string') {
      assert(actualValue === expectedValue, `Export "${key}" must point at ${expectedValue}.`);
      checkedPaths.add(expectedValue);
      continue;
    }

    assert(typeof actualValue === 'object', `Export "${key}" must be an object with typed entries.`);
    assert(actualValue.types === expectedValue.types, `Export "${key}" types path must be ${expectedValue.types}.`);
    assert(actualValue.import === expectedValue.import, `Export "${key}" import path must be ${expectedValue.import}.`);
    assert(actualValue.default === expectedValue.import, `Export "${key}" default path must be ${expectedValue.import}.`);
    checkedPaths.add(expectedValue.types);
    checkedPaths.add(expectedValue.import);
  }

  for (const relativePath of checkedPaths) {
    const absolutePath = path.join(repoRoot, relativePath.replace(/^\.\//, ''));
    assert(await pathExists(absolutePath), `Release export target ${relativePath} does not exist on disk.`);
  }

  return Object.keys(expectedExports);
}

async function validatePacklist(packageJson: PackageJsonShape) {
  assert(Array.isArray(packageJson.files), 'package.json must declare a files allowlist for release hardening.');
  assert(packageJson.files.includes('dist/**'), 'package.json files allowlist must include dist/**.');

  const requiredPackedFiles = [
    'package.json',
    'LICENSE',
    'README.md',
    'docs/builder-api.openapi.json',
    'docs/migration-guide.md',
    'dist/src/sdk/index.js',
    'dist/src/sdk/index.d.ts',
    'dist/src/compat/index.js',
    'dist/src/compat/index.d.ts',
    'dist/src/crypto-envelope.js',
    'dist/src/crypto-envelope.d.ts'
  ];

  await fs.mkdir(npmCacheDir, { recursive: true });

  const { stdout } = await execFileAsync('npm', ['pack', '--json', '--dry-run', '--ignore-scripts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      npm_config_cache: npmCacheDir
    },
    maxBuffer: 16 * 1024 * 1024
  });
  const parsed = JSON.parse(stdout) as Array<{ filename?: string; files?: Array<{ path: string }> }>;
  const packResult = parsed[0];
  assert(packResult, 'npm pack --dry-run did not return a pack summary.');

  const packedPaths = new Set((packResult.files || []).map((entry) => normalizePackPath(entry.path)));
  for (const requiredPath of requiredPackedFiles) {
    assert(packedPaths.has(requiredPath), `Release packlist is missing ${requiredPath}.`);
  }

  const forbiddenPackedSubstrings = ['opengradient-client', 'smoke-compat-opengradient'];
  for (const packedPath of packedPaths) {
    for (const forbidden of forbiddenPackedSubstrings) {
      assert(!packedPath.includes(forbidden), `Release packlist still contains stale legacy artifact ${packedPath}.`);
    }
  }

  return {
    tarball: packResult.filename || null,
    packedFileCount: packedPaths.size,
    requiredPackedFiles
  };
}

async function main() {
  const packageJson = await readPackageJson();
  assert(packageJson.private !== true, 'package.json still marks the package as private.');
  assert(packageJson.name === 'zeko-ai-builder-kit', 'Release package name must remain zeko-ai-builder-kit.');
  assert(
    typeof packageJson.version === 'string' && /^\d+\.\d+\.\d+([-.][0-9A-Za-z-.]+)?$/.test(packageJson.version),
    'package.json must declare a semver version.'
  );
  assert(typeof packageJson.license === 'string' && packageJson.license.length > 0, 'package.json must declare a license field.');

  const exportsValidated = await validateExports(packageJson);
  const packSummary = await validatePacklist(packageJson);

  console.log(
    JSON.stringify(
      {
        ok: true,
        packageName: packageJson.name,
        version: packageJson.version,
        license: packageJson.license,
        exportsValidated,
        tarball: packSummary.tarball,
        packedFileCount: packSummary.packedFileCount,
        requiredPackedFiles: packSummary.requiredPackedFiles
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[release:check] failed', error);
  process.exit(1);
});
