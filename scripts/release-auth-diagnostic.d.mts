import type { Observation } from "./release-auth-readonly.mjs";
export const diagnosticTag: string;
export type Transport = (url: string, options: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; bytes: Buffer; link?: string }>;
export type DiagnosticReport = {
  schema: number; targetTag: string; context: string; result: string; failure: string | null; phase: string;
  httpStatus: Record<string, number>; targetState: "unknown" | "absent" | "draft" | "release" | "draft-and-release";
  metadata: Observation["metadata"] | null; installation: Observation["installation"] | null;
  releases: Observation["releases"] | null; releaseWritePermission: string; draftVisibility: string; publisherVerified: boolean;
};
export function validateDiagnosticContext(env: NodeJS.ProcessEnv): void;
export function validateDiagnosticRequest(method: string, endpoint: string): void;
export function diagnosticGet(endpoint: string, token: string, transport?: Transport): ReturnType<Transport>;
export function runDiagnostic(options?: { env?: NodeJS.ProcessEnv; transport?: Transport }): Promise<DiagnosticReport>;
export function diagnosticMain(options?: { env?: NodeJS.ProcessEnv; transport?: Transport }, write?: (value: string) => void): Promise<number>;
