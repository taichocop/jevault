export function prepareRelease(
  root: string,
  tag?: string,
): Promise<{ version: string; assets: string[] }>;
