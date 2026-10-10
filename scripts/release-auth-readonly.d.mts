export type CommandResult = { status: number; stdout: Buffer; stderr?: Buffer };
export type CommandRunner = (command: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => Promise<CommandResult>;
export type Observation = {
  metadata?: { nameMatches: boolean; repositoryIdMatches: boolean; ownerIdMatches: boolean; permissionsPresent: boolean; push: "true" | "false" | "missing" | "invalid" };
  installation?: { pages: number; count: number; complete: boolean };
  releases?: { pages: number; count: number; drafts: number; complete: boolean };
  targetState?: "absent" | "draft" | "release" | "draft-and-release";
};
export const repository: string;
export const repositoryId: number;
export const ownerId: number;
export function parseApiResponse(result: CommandResult): { status: number; body: unknown };
export function requiredApi(run: CommandRunner, endpoint: string): Promise<unknown>;
export function requireReleaseAuthentication(run: CommandRunner, observe?: (result: Observation) => void): Promise<void>;
export function inspectReleaseState(run: CommandRunner, tag: string, observe?: (result: Observation) => void): Promise<void>;
export function requireNoRelease(run: CommandRunner, tag: string, observe?: (result: Observation) => void): Promise<void>;
