import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';

export interface HomeResolverOptions {
  homedir?: () => string;
  realpath?: (path: string) => Promise<string>;
}

export class HomeResolverError extends Error {
  readonly code: 'home_unavailable';

  constructor(message: string) {
    super(message);
    this.name = 'HomeResolverError';
    this.code = 'home_unavailable';
  }
}

export class HomeResolver {
  readonly #homedir: () => string;
  readonly #realpath: (path: string) => Promise<string>;

  constructor(options: HomeResolverOptions = {}) {
    this.#homedir = options.homedir ?? homedir;
    this.#realpath = options.realpath ?? realpath;
  }

  async resolve(): Promise<string> {
    const home = this.#homedir().trim();
    if (home.length === 0) throw new HomeResolverError('Current user home is unavailable');
    return this.#realpath(home);
  }
}
