// Minimal strict flag parser shared by the CLIs. Unknown flags and positional arguments are errors (fail closed).
// Supports `--flag value`, `--flag=value`, boolean `--flag`, and repeated flags.

export interface FlagSpec {
  readonly values: readonly string[];
  readonly booleans: readonly string[];
  /** Flags that may appear more than once (value flags only). */
  readonly repeatable?: readonly string[];
}

export interface ParsedArgs {
  get(flag: string): string | undefined;
  all(flag: string): readonly string[];
  has(flag: string): boolean;
}

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv: readonly string[], spec: FlagSpec): ParsedArgs {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) throw new UsageError(`unexpected argument ${JSON.stringify(arg)}`);
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (spec.booleans.includes(name)) {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      flags.add(name);
      continue;
    }
    if (!spec.values.includes(name)) throw new UsageError(`unknown flag --${name}`);
    let value: string | undefined;
    if (eq !== -1) value = arg.slice(eq + 1);
    else {
      value = argv[i + 1];
      i++;
    }
    if (value === undefined || value === "") throw new UsageError(`--${name} needs a value`);
    const list = values.get(name) ?? [];
    if (list.length > 0 && !(spec.repeatable ?? []).includes(name)) throw new UsageError(`--${name} given more than once`);
    list.push(value);
    values.set(name, list);
  }
  return {
    get: (flag) => values.get(flag)?.[0],
    all: (flag) => values.get(flag) ?? [],
    has: (flag) => flags.has(flag),
  };
}
