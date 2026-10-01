import type { NoteSource } from "../note-source";

declare const contentBrand: unique symbol;
declare const evaluationBrand: unique symbol;
export interface ContentProvenance { readonly [contentBrand]: true }
export interface EvaluationProvenance { readonly [evaluationBrand]: true }

const fingerprints = new WeakMap<ContentProvenance, string>();
const evaluations = new WeakMap<EvaluationProvenance, Readonly<{
  source: NoteSource;
  revision: Readonly<{ mtime: number; size: number }>;
  content: ContentProvenance;
}>>();

/** opaque tokenだけを公開する。本文・digestはtokenにもJSONにも含めず、永続化しない。 */
export async function fingerprintContent(content: string): Promise<ContentProvenance | undefined> {
  try {
    // UTF-8 encoderの置換文字による同一視を避け、UTF-16 code unitをそのままSHA-256へ渡す。
    const bytes = new Uint8Array(content.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < content.length; index++) view.setUint16(index * 2, content.charCodeAt(index), true);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const token = Object.freeze({}) as ContentProvenance;
    fingerprints.set(token, Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
    return token;
  } catch {
    // crypto unavailableでもread-only提案は継続できるが、Apply用proofは発行しない。
    return undefined;
  }
}

export function sameContent(a: ContentProvenance, b: ContentProvenance): boolean {
  const digest = fingerprints.get(a);
  return digest !== undefined && digest === fingerprints.get(b);
}

export async function captureEvaluationProvenance(source: NoteSource, content: string): Promise<EvaluationProvenance | undefined> {
  if (source.revision === undefined) return undefined;
  const fingerprint = await fingerprintContent(content);
  if (fingerprint === undefined) return undefined;
  const token = Object.freeze({}) as EvaluationProvenance;
  evaluations.set(token, Object.freeze({ source, revision: source.revision, content: fingerprint }));
  return token;
}

export function evaluationContext(provenance: EvaluationProvenance | undefined, source: NoteSource) {
  const context = provenance === undefined ? undefined : evaluations.get(provenance);
  return context?.source === source ? context : undefined;
}
