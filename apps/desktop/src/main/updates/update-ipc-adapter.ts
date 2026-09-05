import type { UpdateController } from './update-controller.js';

export function handleUpdateRequest(
  controller: UpdateController,
  channel: string,
  args: readonly unknown[],
): unknown {
  const id = (index: number): string => {
    const value = args[index];
    if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value))
      throw new Error('Invalid update identifier');
    return value;
  };
  const count = (expected: number): void => {
    if (args.length !== expected) throw new Error('Invalid update arguments');
  };
  switch (channel) {
    case 'updates:get-state':
      count(0);
      return controller.getState();
    case 'updates:set-automatic-checks':
      count(1);
      if (typeof args[0] !== 'boolean') throw new Error('Invalid update preference');
      return controller.setAutomaticChecks(args[0]);
    case 'updates:check':
      count(0);
      return controller.check();
    case 'updates:download':
      count(1);
      return controller.download(id(0));
    case 'updates:cancel':
      count(0);
      return controller.cancel();
    case 'updates:install-impact':
      count(1);
      return controller.getInstallImpact(id(0));
    case 'updates:install':
      count(2);
      return controller.install(id(0), id(1));
    default:
      throw new Error('Update channel is not available');
  }
}
