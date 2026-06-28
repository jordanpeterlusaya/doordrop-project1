type RuntimeEnv = Record<string, string | undefined>;

export function getRuntimeEnv() {
  if (typeof process === 'undefined' || !process?.env) {
    return {} as RuntimeEnv;
  }

  return process.env as RuntimeEnv;
}

export function getRuntimeEnvValue(key: string) {
  const value = getRuntimeEnv()[key];
  return typeof value === 'string' ? value : '';
}
