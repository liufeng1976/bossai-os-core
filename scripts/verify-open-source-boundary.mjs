import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

const root = process.cwd();
const manifestPath = join(root, 'OSS_PUBLIC_EXPORT_MANIFEST.json');
if (!existsSync(manifestPath)) throw new Error('OSS_PUBLIC_EXPORT_MANIFEST.json is required.');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const expectedPackages = [
  'packages/ai-contracts',
  'packages/skill-engine',
  'packages/workflow-engine',
  'packages/file-parser',
  'packages/local-rag',
  'packages/webhook-security',
];

const actualPackages = [...manifest.packageRoots].sort();
const expectedSorted = [...expectedPackages].sort();
if (JSON.stringify(actualPackages) !== JSON.stringify(expectedSorted)) {
  throw new Error(`Public package boundary changed. Expected ${expectedSorted.join(', ')}; got ${actualPackages.join(', ')}.`);
}

for (const required of ['OPEN_SOURCE_BOUNDARY.md', 'LICENSE', 'TRADEMARKS.md']) {
  if (!manifest.rootFiles.includes(required)) throw new Error(`${required} must be part of the public export manifest.`);
}

const forbiddenPaths = [
  'apps', 'agents', 'agent', 'commerce', 'connectors', 'governance', 'harnesses', 'third_party',
  'packages/shared', 'packages/ai-gateway', 'packages/license-core', 'packages/ui',
  'outputs', 'release', 'data', 'demo-data', 'prisma',
];
const strictExportTree = process.argv.includes('--export-tree');
if (strictExportTree) {
  for (const path of forbiddenPaths) {
    if (existsSync(join(root, path))) throw new Error(`Forbidden public path exists: ${path}`);
  }
}

const forbiddenPatterns = [
  /bossai_points/i,
  /commercial-entitlement/i,
  /pointsConsumed/,
  /ProviderRouter/,
  /CredentialAuthority/,
  /DecisionMemory/,
];

const allowedRoots = [...manifest.packageRoots];
const textExtensions = new Set(['.js', '.mjs', '.ts', '.json', '.md', '.yml', '.yaml']);
function walk(path) {
  const full = join(root, path);
  if (!existsSync(full)) return [];
  if (!statSync(full).isDirectory()) return [path];
  const out = [];
  for (const entry of readdirSync(full)) {
    const child = join(path, entry);
    const childFull = join(root, child);
    if (statSync(childFull).isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

for (const file of allowedRoots.flatMap(walk)) {
  const normalized = file.split(sep).join('/');
  const ext = normalized.slice(normalized.lastIndexOf('.'));
  if (!textExtensions.has(ext)) continue;
  const content = readFileSync(join(root, file), 'utf8');
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(content)) throw new Error(`Forbidden commercial/runtime residue ${pattern} found in ${normalized}.`);
  }
}

console.log('Open-source boundary verification: PASS');
