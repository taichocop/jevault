export interface LifecycleRequest {
  method: string;
  url: string;
  host: string;
  body?: { tag_name?: string; draft?: boolean; prerelease?: boolean; name?: string; body?: string };
  bytes?: Buffer;
}
export function releaseLifecycle(scenario: string, assets: Record<string, Buffer>): {
  handle(request: LifecycleRequest): Promise<{ status?: number; body?: unknown; drop?: boolean }>;
  snapshot(): { state: string; assets: string[]; assetsBeforeDelete: string[]; published: boolean;
    attempts: Record<string, number>; requests: { method: string; host: string; url: string; status?: number; dropped: boolean }[] };
};
export const lifecycleCases: { name: string; ok?: boolean; uploads: number; patch: number; remove: number;
  state: string; assetCount: number; beforeDelete?: number }[];
