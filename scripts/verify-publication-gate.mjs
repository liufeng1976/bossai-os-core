import { spawnSync } from 'node:child_process';

const checks = [
  ['open-source boundary', ['pnpm', ['verify:open-source-boundary']]],
  ['build', ['pnpm', ['build']]],
  ['test', ['pnpm', ['test']]],
  ['typecheck', ['pnpm', ['typecheck']]],
];

let failed = false;
for (const [label, [command, args]] of checks) {
  const pnpmCli = process.env.npm_execpath;
  const executable = command === 'pnpm' && pnpmCli ? process.execPath : command;
  const executableArgs = command === 'pnpm' && pnpmCli ? [pnpmCli, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
  });
  if (result.status !== 0) {
    console.error(`Publication gate failed: ${label}`);
    failed = true;
    break;
  }
}

if (failed) process.exit(1);
console.log('BossAI OS Core publication gate: PASS');
