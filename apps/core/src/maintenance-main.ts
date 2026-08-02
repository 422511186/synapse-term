import { isCoreRunning, runCoreMaintenance } from './maintenance-cli.js';

process.exitCode = await runCoreMaintenance(process.argv.slice(2), {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  isCoreRunning,
});
