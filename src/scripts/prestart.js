const { spawnSync } = require('child_process');

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCommand, ['audit', '--omit=dev'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
});

if (result.error) {
    console.warn(`[warn] npm audit could not be executed before startup: ${result.error.message}`);
    process.exit(0);
}

if (typeof result.status === 'number' && result.status !== 0) {
    console.warn('[warn] npm audit reported issues or could not complete. Continuing startup.');
}

process.exit(0);
