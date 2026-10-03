import { fixtureSource } from "./helpers/note-source";
import { describe, expect, it, vi } from "vitest";

import {
  MissingApiKeyError,
  NetworkError,
  NoCandidatesError,
  TypeSafeApiError,
  UnsupportedFileError,
  NoActiveNoteError,
} from "../src/classification/classification-errors";
import type { ExistingTagSnapshot } from "../src/tags/existing-tag-snapshot";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";
import { TagSuggestionGrantIssuer, isIssuedSuggestionGrant, type TagSuggestionGrantLifetime } from "../src/tags/tag-suggestion-grant";
import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import type { TagApplyPreparedPresentation } from "../src/tags/tag-apply-preparation";
import { TagSuggestionCommand } from "../src/tags/tag-suggestion-command";

const success: TagSuggestionServiceResult = {
  status: "success",
  source: fixtureSource(),
  noteTitle: "IAM Role",
  suggestions: [{ tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.964 }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createCommand(
  suggestForActiveNote: (signal?: AbortSignal) => Promise<TagSuggestionServiceResult>,
  getActiveNotePath: () => string | null = () => "Inbox/IAM Role.md",
) {
  const hide = vi.fn();
  const showLoading = vi.fn(() => ({ hide }));
  const showSuggestions = vi.fn((
    _outcome: TagSuggestionServiceResult,
    _snapshot: ExistingTagSnapshot,
    signal: AbortSignal,
    presentation: TagApplyPreparedPresentation,
  ) => {
    signal.addEventListener("abort", () => presentation.dispose(), { once: true });
  });
  const showError = vi.fn();
  const snapshot = vi.fn(() => ({ status: "available" as const, names: ["#aws"] }));
  const vault = { getFileByPath: vi.fn(() => null) };
  const grantIssuer = new TagSuggestionGrantIssuer(vault);
  const issue = vi.spyOn(grantIssuer, "issue");
  const command = new TagSuggestionCommand({
    grantIssuer,
    startPreparation: () => {
      let lifetime: TagSuggestionGrantLifetime | undefined;
      return {
        get suggestionGrant() { return lifetime?.grant; },
        suggestionFreshness: "unknown",
        getReadiness: () => ({ status: "blocked", reason: "grant-unavailable", freshness: "unknown" }),
        confirm: () => undefined,
        prepare: (_outcome, issuedLifetime) => { lifetime = issuedLifetime; },
        dispose: () => lifetime?.dispose(),
      };
    },
    existingTags: { snapshot },
    tagSuggestionService: { suggestForActiveNote },
    getActiveNotePath,
    showLoading,
    showSuggestions,
    showError,
  });

  return { command, vault, issue, snapshot, hide, showError, showLoading, showSuggestions };
}

describe("TagSuggestionCommand", () => {
  it("invokes TagSuggestionService once and shows only a successful result", async () => {
    const suggestForActiveNote = vi.fn(async () => success);
    const { command, snapshot, hide, showSuggestions } = createCommand(suggestForActiveNote);

    await command.execute();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(1);
    expect(suggestForActiveNote).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(showSuggestions).toHaveBeenCalledWith(success, { status: "available", names: ["#aws"] }, expect.any(AbortSignal), expect.objectContaining({ dispose: expect.any(Function) }));
    expect(snapshot).toHaveBeenCalledExactlyOnceWith(success.source);
    expect(hide).toHaveBeenCalledOnce();
  });

  it("prevents a duplicate request for the same note while pending", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggestForActiveNote = vi.fn(() => pending.promise);
    const { command, hide, showLoading } = createCommand(suggestForActiveNote);

    const first = command.execute();
    const second = command.execute();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(1);
    expect(showLoading).toHaveBeenCalledTimes(1);
    pending.resolve(success);
    await Promise.all([first, second]);
    expect(hide).toHaveBeenCalledOnce();
  });

  it("allows another request after completion", async () => {
    const suggestForActiveNote = vi.fn(async () => success);
    const { command } = createCommand(suggestForActiveNote);

    await command.execute();
    await command.execute();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
  });

  it("allows explicit requests for different notes to run concurrently", async () => {
    const requests = [
      deferred<TagSuggestionServiceResult>(),
      deferred<TagSuggestionServiceResult>(),
    ];
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockImplementationOnce(() => requests[0]!.promise)
      .mockImplementationOnce(() => requests[1]!.promise);
    let activePath = "Inbox/First.md";
    const { command } = createCommand(suggestForActiveNote, () => activePath);

    const first = command.execute();
    activePath = "Inbox/Second.md";
    const second = command.execute();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    requests[0]!.resolve(success);
    requests[1]!.resolve(success);
    await Promise.all([first, second]);
  });

  it("retries through TagSuggestionService and shows suggestions after success", async () => {
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(success);
    const { command, hide, showError, showSuggestions } =
      createCommand(suggestForActiveNote);

    await command.execute();
    const retry = showError.mock.calls[0]?.[1] as () => Promise<unknown>;
    await expect(retry()).resolves.toEqual({ status: "success" });

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    expect(showError).toHaveBeenCalledWith(
      {
        message: "Jevault couldn't suggest tags for this note.\nPlease try again.",
        retryable: true,
      },
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(showSuggestions).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("shows the latest error after retry failure", async () => {
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockRejectedValueOnce(new NetworkError())
      .mockRejectedValueOnce(new MissingApiKeyError());
    const { command, hide, showError, showSuggestions } =
      createCommand(suggestForActiveNote);

    await command.execute();
    const retry = showError.mock.calls[0]?.[1] as () => Promise<unknown>;
    await expect(retry()).resolves.toEqual({
      status: "failure",
      presentation: {
        message:
          "TypeSafe API key is not configured.\nOpen Jevault settings to select a secret.",
        retryable: false,
      },
    });

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    expect(showSuggestions).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("prevents duplicate Retry requests while the first Retry is pending", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockRejectedValueOnce(new NetworkError())
      .mockImplementationOnce(() => pending.promise);
    const { command, showError } = createCommand(suggestForActiveNote);

    await command.execute();
    const retry = showError.mock.calls[0]?.[1] as () => Promise<unknown>;
    const first = retry();
    const second = retry();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toEqual({ status: "ignored" });
    pending.resolve(success);
    await expect(first).resolves.toEqual({ status: "success" });
  });

  it("maps non-retryable failures without a Retry callback", async () => {
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockRejectedValue(new NoActiveNoteError());
    const { command, showError } = createCommand(suggestForActiveNote);

    await command.execute();

    expect(showError).toHaveBeenCalledWith(
      {
        message: "Open a Markdown note before running Jevault.",
        retryable: false,
      },
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("hides every pending loading handle and ignores late success after dispose", async () => {
    const requests = [
      deferred<TagSuggestionServiceResult>(),
      deferred<TagSuggestionServiceResult>(),
    ];
    const suggestForActiveNote = vi
      .fn<() => Promise<TagSuggestionServiceResult>>()
      .mockImplementationOnce(() => requests[0]!.promise)
      .mockImplementationOnce(() => requests[1]!.promise);
    let activePath = "Inbox/First.md";
    const { command, hide, showSuggestions } = createCommand(
      suggestForActiveNote,
      () => activePath,
    );

    const first = command.execute();
    activePath = "Inbox/Second.md";
    const second = command.execute();
    command.dispose();

    expect(hide).toHaveBeenCalledTimes(2);
    requests[0]!.resolve(success);
    requests[1]!.resolve(success);
    await Promise.all([first, second]);
    expect(showSuggestions).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledTimes(2);
  });

  it("consumes a pending rejection without failure UI after dispose", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggestForActiveNote = vi.fn(() => pending.promise);
    const { command, hide, showError } = createCommand(suggestForActiveNote);

    const execution = command.execute();
    command.dispose();
    pending.reject(new Error("late network failure"));
    await execution;

    expect(showError).not.toHaveBeenCalled();
    expect(hide).toHaveBeenCalledOnce();
  });

  it("does not start Tag Suggest after dispose", async () => {
    const suggestForActiveNote = vi.fn(async () => success);
    const { command, showLoading } = createCommand(suggestForActiveNote);

    command.dispose();
    await command.execute();

    expect(suggestForActiveNote).not.toHaveBeenCalled();
    expect(showLoading).not.toHaveBeenCalled();
  });
});

describe("TagSuggestionCommand cancellation", () => {
  it("passes abort to all pending service calls on dispose", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggestForActiveNote = vi.fn<
      (signal?: AbortSignal) => Promise<TagSuggestionServiceResult>
    >(() => pending.promise);
    let activePath = "Inbox/First.md";
    const { command, hide } = createCommand(suggestForActiveNote, () => activePath);

    const first = command.execute();
    activePath = "Inbox/Second.md";
    const second = command.execute();
    const signals = suggestForActiveNote.mock.calls.map(([signal]) => signal!);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    command.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(hide).toHaveBeenCalledTimes(2);
    pending.resolve(success);
    await Promise.all([first, second]);
  });

  it("does not start a Retry with an already aborted owner signal", async () => {
    const suggestForActiveNote = vi.fn(async () => {
      throw new NetworkError();
    });
    const { command, showError, showLoading } = createCommand(suggestForActiveNote);
    await command.execute();
    const retry = showError.mock.calls[0]?.[1] as
      (signal: AbortSignal) => Promise<unknown>;
    const owner = new AbortController();
    owner.abort();

    await expect(retry(owner.signal)).resolves.toEqual({ status: "ignored" });
    expect(suggestForActiveNote).toHaveBeenCalledOnce();
    expect(showLoading).toHaveBeenCalledOnce();
  });
});

 describe("TagSuggestionCommand result boundary", () => {
  it("shows empty suggestions as success", async () => {
    const empty = { ...success, suggestions: [] };
    const h = createCommand(async () => empty);
    await h.command.execute();
    expect(h.showError).not.toHaveBeenCalled();
    expect(h.showSuggestions).toHaveBeenCalledWith(empty, { status: "available", names: ["#aws"] }, expect.any(AbortSignal), expect.objectContaining({ dispose: expect.any(Function) }));
  });
  it("suppresses UI when snapshot boundary disposes the command", async () => {
    const h = createCommand(async () => success);
    h.snapshot.mockImplementation(() => { h.command.dispose(); return { status: "available", names: [] }; });
    await h.command.execute();
    expect(h.showSuggestions).not.toHaveBeenCalled();
    expect(h.showError).not.toHaveBeenCalled();
    expect(h.hide).toHaveBeenCalledOnce();
  });
  it("suppresses error when disposed between run and execute continuation", async () => {
    const h = createCommand(async () => { throw new NetworkError(); });
    const execution = h.command.execute();
    await Promise.resolve();
    h.command.dispose();
    await execution;
    expect(h.showError).not.toHaveBeenCalled();
  });
});

function shownPresentation(h: ReturnType<typeof createCommand>, index = 0): TagApplyPreparedPresentation {
  return h.showSuggestions.mock.calls[index][3] as TagApplyPreparedPresentation;
}

describe("TagSuggestionCommand grant lifetime", () => {
  it("issues exactly once after final success with the original result source", async () => {
    const pending = deferred<TagSuggestionServiceResult>(); const h = createCommand(() => pending.promise);
    const run = h.command.execute(); expect(h.issue).not.toHaveBeenCalled();
    pending.resolve(success); await run;
    const presentation = shownPresentation(h); const grant = presentation.suggestionGrant!;
    expect(h.issue).toHaveBeenCalledExactlyOnceWith(success);
    expect(grant.source).toBe(success.source); expect(grant.allowedTags).toEqual(["#aws"]);
    expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(true);
    presentation.dispose(); presentation.dispose();
    expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(false); h.command.dispose();
  });
  it("Close/replacement and explicit Retry success use distinct grants while old grants stay revoked", async () => {
    const suggest = vi.fn<() => Promise<TagSuggestionServiceResult>>()
      .mockResolvedValueOnce(success).mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(success);
    const h = createCommand(suggest); await h.command.execute();
    const old = shownPresentation(h); const oldGrant = old.suggestionGrant!; old.dispose();
    await h.command.execute(); const retry = h.showError.mock.calls[0][1] as () => Promise<unknown>;
    await retry(); const next = shownPresentation(h, 1).suggestionGrant!;
    expect(next).not.toBe(oldGrant); expect(h.issue).toHaveBeenCalledTimes(2);
    expect(isIssuedSuggestionGrant(oldGrant, h.vault)).toBe(false);
    expect(isIssuedSuggestionGrant(next, h.vault)).toBe(true);
    h.command.dispose(); expect(isIssuedSuggestionGrant(next, h.vault)).toBe(false);
  });
  it("unload revokes multiple open grants and ignores a late pending success", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggest = vi.fn<() => Promise<TagSuggestionServiceResult>>()
      .mockResolvedValueOnce(success).mockResolvedValueOnce(success).mockImplementationOnce(() => pending.promise);
    const h = createCommand(suggest); await h.command.execute(); await h.command.execute();
    const grants = [shownPresentation(h).suggestionGrant!, shownPresentation(h, 1).suggestionGrant!];
    const run = h.command.execute(); h.command.dispose(); h.command.dispose();
    grants.forEach(grant => expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(false));
    pending.resolve(success); await run;
    expect(h.issue).toHaveBeenCalledTimes(2); expect(h.showSuggestions).toHaveBeenCalledTimes(2);
  });
  it("transfers disposal ownership so the UI can await an already-started Apply on unload", async () => {
    const h = createCommand(async () => success);
    const pendingApply = deferred<void>();
    const closeUi = vi.fn();
    let disposeAfterApply!: Promise<void>;
    h.showSuggestions.mockImplementation((_outcome, _snapshot, signal, presentation) => {
      signal.addEventListener("abort", () => {
        closeUi();
        disposeAfterApply = pendingApply.promise.then(() => presentation.dispose());
      }, { once: true });
    });
    await h.command.execute();
    const presentation = shownPresentation(h), grant = presentation.suggestionGrant!;
    const dispose = vi.spyOn(presentation, "dispose");

    h.command.dispose(); h.command.dispose();
    expect(closeUi).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(true);

    pendingApply.resolve(); await disposeAfterApply;
    expect(dispose).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(false);
  });
  it("explicit owner abort suppresses issuance even if the service completes late", async () => {
    const pending = deferred<TagSuggestionServiceResult>();
    const suggest = vi.fn<() => Promise<TagSuggestionServiceResult>>()
      .mockRejectedValueOnce(new NetworkError()).mockImplementationOnce(() => pending.promise);
    const h = createCommand(suggest); await h.command.execute();
    const retry = h.showError.mock.calls[0][1] as (signal: AbortSignal) => Promise<unknown>;
    const owner = new AbortController(); const run = retry(owner.signal); owner.abort(); pending.resolve(success); await run;
    expect(h.issue).not.toHaveBeenCalled(); expect(h.showSuggestions).not.toHaveBeenCalled(); h.command.dispose();
  });
  it.each([new NetworkError(), new NoActiveNoteError(), new UnsupportedFileError(), new NoCandidatesError(),
    new MissingApiKeyError(), new TypeSafeApiError(), new ClassificationCancelledError()])(
    "failure/cancellation leaves no usable grant: %s", async (error) => {
      const h = createCommand(async () => { throw error; }); await h.command.execute();
      expect(h.issue).not.toHaveBeenCalled(); expect(h.showSuggestions).not.toHaveBeenCalled(); h.command.dispose();
    },
  );
  it("presentation failure revokes the issued grant before transfer", async () => {
    const h = createCommand(async () => success);
    h.showSuggestions.mockImplementation(() => { throw new Error("Synthetic presentation failure"); });
    await h.command.execute();
    const lifetime = h.issue.mock.results[0].value!;
    expect(isIssuedSuggestionGrant(lifetime.grant, h.vault)).toBe(false); h.command.dispose();
  });
  it("unload at snapshot boundary revokes issuance without presenting", async () => {
    const h = createCommand(async () => success);
    h.snapshot.mockImplementation(() => { h.command.dispose(); return { status: "available", names: [] }; });
    await h.command.execute();
    expect(h.issue).toHaveBeenCalledOnce();
    expect(isIssuedSuggestionGrant(h.issue.mock.results[0].value!.grant, h.vault)).toBe(false);
    expect(h.showSuggestions).not.toHaveBeenCalled();
  });
  it("invalid runtime issuance preserves read-only suggestions without a forged/default grant", async () => {
    const invalid = { ...success, suggestions: [{ ...success.suggestions[0], choice: "other" as const }] };
    const h = createCommand(async () => invalid); await h.command.execute();
    expect(h.showSuggestions).toHaveBeenCalledOnce(); expect(h.showError).not.toHaveBeenCalled();
    expect(shownPresentation(h).suggestionGrant).toBeUndefined(); h.command.dispose();
  });
  it("successful empty result still has an active empty grant", async () => {
    const h = createCommand(async () => ({ ...success, suggestions: [] })); await h.command.execute();
    const grant = shownPresentation(h).suggestionGrant!;
    expect(grant.allowedTags).toEqual([]); expect(isIssuedSuggestionGrant(grant, h.vault)).toBe(true); h.command.dispose();
  });
});
