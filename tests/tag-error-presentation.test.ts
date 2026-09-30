import { describe, expect, it } from "vitest";

import {
  InvalidTypeSafeResponseError,
  MissingApiKeyError,
  NetworkError,
  NoActiveNoteError,
  NoCandidatesError,
  TypeSafeApiError,
  UnsupportedFileError,
} from "../src/classification/classification-errors";
import { createTagErrorPresentation } from "../src/tags/tag-error-presentation";

describe("Tag error presentation", () => {
  it.each([
    [
      new MissingApiKeyError(),
      "TypeSafe API key is not configured.\nOpen Jevault settings to select a secret.",
    ],
    [
      new NoActiveNoteError(),
      "Open a Markdown note before running Jevault.",
    ],
    [
      new UnsupportedFileError(),
      "Tags can't be suggested for this file. Open a Markdown note and try again.",
    ],
    [new NoCandidatesError(), "No existing tags are available in this vault."],
  ])("maps %s to a safe non-retryable message", (error, message) => {
    expect(createTagErrorPresentation(error)).toEqual({
      message,
      retryable: false,
    });
  });

  it.each([
    new NetworkError(),
    new TypeSafeApiError(),
    new InvalidTypeSafeResponseError(),
  ])("maps %s to the shared safe retryable message", (error) => {
    const presentation = createTagErrorPresentation(error);

    expect(presentation).toEqual({
      message: "Jevault couldn't suggest tags for this note.\nPlease try again.",
      retryable: true,
    });
    expect(presentation.message).not.toContain(error.stack ?? error.message);
  });

  it("does not expose an unknown raw error", () => {
    expect(
      createTagErrorPresentation(new Error("raw provider response and secret")),
    ).toEqual({
      message: "Jevault couldn't suggest tags for this note.",
      retryable: false,
    });
  });
});
