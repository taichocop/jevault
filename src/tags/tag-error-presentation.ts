import {
  InvalidTypeSafeResponseError,
  MissingApiKeyError,
  NetworkError,
  NoActiveNoteError,
  NoCandidatesError,
  TypeSafeApiError,
  UnsupportedFileError,
} from "../classification/classification-errors";

import type { ErrorPresentation } from "../suggestion/error-presentation";

const RETRYABLE_MESSAGE =
  "Jevault couldn't suggest tags for this note.\nPlease try again.";

/** 内部例外のmessageを使わず、固定済みの安全な表示だけへ変換する。 */
export function createTagErrorPresentation(error: unknown): ErrorPresentation {
  if (error instanceof MissingApiKeyError) {
    return {
      message:
        "TypeSafe API key is not configured.\nOpen Jevault settings to select a secret.",
      retryable: false,
    };
  }
  if (error instanceof NoActiveNoteError) {
    return {
      message: "Open a Markdown note before running Jevault.",
      retryable: false,
    };
  }
  if (error instanceof UnsupportedFileError) {
    return {
      message: "Tags can't be suggested for this file. Open a Markdown note and try again.",
      retryable: false,
    };
  }
  if (error instanceof NoCandidatesError) {
    return {
      message: "No existing tags are available in this vault.",
      retryable: false,
    };
  }
  if (
    error instanceof NetworkError ||
    error instanceof TypeSafeApiError ||
    error instanceof InvalidTypeSafeResponseError
  ) {
    return { message: RETRYABLE_MESSAGE, retryable: true };
  }

  // 未知の例外も技術詳細を露出せず、自動・手動の再通信は許可しない。
  return { message: "Jevault couldn't suggest tags for this note.", retryable: false };
}
