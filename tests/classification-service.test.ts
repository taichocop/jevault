import { fixtureSource } from "./helpers/note-source";
import { describe, expect, it, vi } from "vitest";

import { CandidateBuilder } from "../src/classification/candidate-builder";
import {
  MissingApiKeyError,
  NetworkError,
  TypeSafeApiError,
  InvalidTypeSafeResponseError,
  NoActiveNoteError,
  NoCandidatesError,
  UnsupportedFileError,
} from "../src/classification/classification-errors";
import {
  ClassificationService,
  type ClassifierFactory,
} from "../src/classification/classification-service";
import type { Classifier } from "../src/classification/classifier";
import type { NoteStateResult } from "../src/note-service";
import type { JevaultSettings } from "../src/settings";
import { ClassificationCancelledError } from "../src/classification/classification-cancellation";
import { TypeSafeAdapter } from "../src/classification/typesafe-adapter";
import { VaultService } from "../src/vault-service";
import type { TFolder } from "obsidian";

const settings: JevaultSettings = {
  apiKeySecretName: "typesafe-api-key",
  inboxPath: "Inbox",
  ignoredFolders: ["Templates", "Attachments"],
  suggestionCount: 3,
};

const readyNote: NoteStateResult = {
  status: "ready",
  source: fixtureSource("programming/aws/S3 Storage Classes.md"),
  note: {
    title: "Amazon S3 Storage Classes",
    path: "programming/aws/S3 Storage Classes.md",
    body: "Amazon S3 has multiple storage classes.",
  },
};

function createService(options: {
  noteState?: NoteStateResult;
  folderPaths?: string[];
  apiKey?: string | null;
  suggestionCount?: number;
  classifier?: Classifier;
} = {}) {
  const classify = vi.fn(async () => ({
    candidates: [
      { path: "programming/ruby", probability: 0.1 },
      { path: "programming/aws", probability: 0.85 },
      { path: "health/fitness", probability: 0.05 },
    ],
    providerConfidence: 0.77,
  }));
  const classifier = options.classifier ?? { classify };
  const classifierFactory = vi.fn<ClassifierFactory>(() => classifier);
  const getApiKey = vi.fn(() =>
    options.apiKey === undefined ? "unit-test-api-key" : options.apiKey,
  );
  const getActiveNoteState = vi.fn(async () => options.noteState ?? readyNote);
  const service = new ClassificationService(
    { getActiveNoteState },
    {
      getAvailableFolderPaths: vi.fn(() =>
        options.folderPaths ?? [
          "programming/aws",
          "programming/ruby",
          "health/fitness",
        ],
      ),
    },
    new CandidateBuilder(),
    { getApiKey },
    classifierFactory,
    () => ({
      ...settings,
      suggestionCount: options.suggestionCount ?? settings.suggestionCount,
    }),
  );

  return { classify, classifierFactory, getApiKey, getActiveNoteState, service };
}

describe("ClassificationService", () => {
  it("forwards arbitrary Vault paths instead of fixed spike candidates", async () => {
    const classifier: Classifier = {
      classify: vi.fn(async () => ({
        candidates: [
          { path: "InboxArchive", probability: 0.2 },
          { path: "research/machine-learning", probability: 0.8 },
        ],
      })),
    };
    const { service } = createService({
      classifier,
      folderPaths: ["research/machine-learning", "InboxArchive"],
    });

    await expect(service.classifyActiveNote()).resolves.toMatchObject({
      status: "success",
      result: {
        candidates: [
          { path: "research/machine-learning", probability: 0.8 },
          { path: "InboxArchive", probability: 0.2 },
        ],
      },
    });
    expect(classifier.classify).toHaveBeenCalledWith(readyNote.note, [
      {
        path: "research/machine-learning",
        description: "Existing vault folder: research/machine-learning",
      },
      {
        path: "InboxArchive",
        description: "Existing vault folder: InboxArchive",
      },
    ], undefined);
  });

  it("forwards dynamic candidates, sorts by probability, and preserves provider confidence", async () => {
    const { classify, classifierFactory, service } = createService();

    await expect(service.classifyActiveNote()).resolves.toEqual({
      status: "success",
      noteTitle: "Amazon S3 Storage Classes",
      source: readyNote.source,
      result: {
        candidates: [
          { path: "programming/aws", probability: 0.85 },
          { path: "programming/ruby", probability: 0.1 },
          { path: "health/fitness", probability: 0.05 },
        ],
        providerConfidence: 0.77,
      },
    });
    expect(classifierFactory).toHaveBeenCalledWith("unit-test-api-key");
    expect(classify).toHaveBeenCalledWith(readyNote.note, [
      {
        path: "programming/aws",
        description: "Existing vault folder: programming/aws",
      },
      {
        path: "programming/ruby",
        description: "Existing vault folder: programming/ruby",
      },
      {
        path: "health/fitness",
        description: "Existing vault folder: health/fitness",
      },
    ], undefined);
  });

  it("returns only the configured top candidates after sorting", async () => {
    const { service } = createService({ suggestionCount: 2 });

    await expect(service.classifyActiveNote()).resolves.toMatchObject({
      status: "success",
      result: {
        candidates: [
          { path: "programming/aws", probability: 0.85 },
          { path: "programming/ruby", probability: 0.1 },
        ],
      },
    });
  });

  it("returns one candidate when fewer than suggestionCount exist", async () => {
    const classifier: Classifier = {
      classify: vi.fn(async () => ({
        candidates: [{ path: "InboxArchive", probability: 1 }],
      })),
    };
    const { service } = createService({
      classifier,
      folderPaths: ["InboxArchive"],
    });

    await expect(service.classifyActiveNote()).resolves.toEqual({
      status: "success",
      noteTitle: "Amazon S3 Storage Classes",
      source: readyNote.source,
      result: {
        candidates: [{ path: "InboxArchive", probability: 1 }],
      },
    });
  });

  it.each([null, "", " ", "   ", "\n", "\t", " \n\t "])(
    "does not create or call a classifier for missing or blank secret %j",
    async (apiKey) => {
      const { classify, classifierFactory, service } = createService({ apiKey });

      await expect(service.classifyActiveNote()).rejects.toThrow(
        MissingApiKeyError,
      );
      expect(classifierFactory).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("does not resolve a secret or call a classifier when no candidates exist", async () => {
    const { classify, classifierFactory, getApiKey, service } = createService({
      folderPaths: [],
    });

    await expect(service.classifyActiveNote()).rejects.toThrow(
      NoCandidatesError,
    );
    expect(getApiKey).not.toHaveBeenCalled();
    expect(classifierFactory).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });

  it.each([
    ["no-active-file", NoActiveNoteError],
    ["unsupported-file", UnsupportedFileError],
  ] as const)("does not call a classifier for %s", async (status, ErrorType) => {
      const { classify, classifierFactory, getApiKey, service } = createService({
        noteState: { status },
      });

      await expect(service.classifyActiveNote()).rejects.toThrow(ErrorType);
      expect(getApiKey).not.toHaveBeenCalled();
      expect(classifierFactory).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    });
});

describe("ClassificationService prepared-note entry", () => {
  it("uses the supplied note/source, preserving ordering, truncation and safe output", async () => {
    const h = createService({ noteState: { status: "no-active-file" }, suggestionCount: 2 });
    const note = Object.freeze({ title: "Exact target", path: "Inbox/Exact.md", body: "Synthetic prepared body" });
    const source = fixtureSource(note.path);
    const signal = new AbortController().signal;
    const result = await h.service.classifyNote(note, source, signal);
    expect(result).toEqual({ status: "success", noteTitle: note.title, source, result: {
      candidates: [{ path: "programming/aws", probability: 0.85 }, { path: "programming/ruby", probability: 0.1 }], providerConfidence: 0.77,
    } });
    expect(h.classify.mock.calls[0]).toEqual([note, [
      { path: "programming/aws", description: "Existing vault folder: programming/aws" },
      { path: "programming/ruby", description: "Existing vault folder: programming/ruby" },
      { path: "health/fitness", description: "Existing vault folder: health/fitness" },
    ], signal]);
    expect(JSON.stringify(result)).not.toContain(note.body);
    expect(JSON.stringify(result)).not.toContain("unit-test-api-key");
    expect(Object.keys(result).sort()).toEqual(["noteTitle", "result", "source", "status"]);
    expect(h.getActiveNoteState).not.toHaveBeenCalled();
  });

  it("rejects absent candidates before Secret lookup", async () => {
    const h = createService({ folderPaths: [] });
    await expect(h.service.classifyNote(readyNote.note, readyNote.source)).rejects.toBeInstanceOf(NoCandidatesError);
    expect(h.getApiKey).not.toHaveBeenCalled(); expect(h.classifierFactory).not.toHaveBeenCalled();
  });

  it.each([null, "", "   "])("rejects missing Secret %j without provider", async apiKey => {
    const h = createService({ apiKey });
    await expect(h.service.classifyNote(readyNote.note, readyNote.source)).rejects.toBeInstanceOf(MissingApiKeyError);
    expect(h.classifierFactory).not.toHaveBeenCalled(); expect(h.classify).not.toHaveBeenCalled();
  });

  it("uses unchanged VaultService exclusions and CandidateBuilder descriptions", async () => {
    const classify = vi.fn<Classifier["classify"]>(async (_note, candidates) => ({ candidates: candidates.map(({ path }) => ({ path, probability: 1 })) }));
    const vault = { configDir: ".obsidian", getAllFolders: vi.fn(() =>
      [".obsidian", ".obsidian/Plugins", "Inbox", "Inbox/Nested", "Templates", "Templates/Nested", "InboxArchive", "健康/運動"]
        .map(path => ({ path }) as TFolder)) };
    const active = vi.fn(async () => readyNote);
    const service = new ClassificationService({ getActiveNoteState: active }, new VaultService(vault),
      new CandidateBuilder(), { getApiKey: () => "unit-test-only" }, () => ({ classify }), () => settings);
    await service.classifyNote(readyNote.note, readyNote.source);
    expect(classify.mock.calls[0][1]).toEqual([
      { path: "InboxArchive", description: "Existing vault folder: InboxArchive" },
      { path: "健康/運動", description: "Existing vault folder: 健康/運動" },
    ]);
    expect(active).not.toHaveBeenCalled(); expect(vault.getAllFolders).toHaveBeenCalledWith(false);
  });

  it.each([NetworkError, TypeSafeApiError, InvalidTypeSafeResponseError, ClassificationCancelledError])(
    "preserves typed classifier failure %s", async ErrorType => {
      const error = new ErrorType(); const classify = vi.fn<Classifier["classify"]>().mockRejectedValue(error);
      const h = createService({ classifier: { classify } });
      await expect(h.service.classifyNote(readyNote.note, readyNote.source)).rejects.toBe(error);
    },
  );

  it.each(["pre-abort", "secret", "provider"])("preserves cancellation at %s", async stage => {
    const controller = new AbortController();
    const h = createService();
    if (stage === "pre-abort") controller.abort();
    if (stage === "secret") h.getApiKey.mockImplementation(() => { controller.abort(); return "unit-test-only"; });
    if (stage === "provider") h.classify.mockImplementation(async () => { controller.abort(); return { candidates: [], providerConfidence: 0 }; });
    await expect(h.service.classifyNote(readyNote.note, readyNote.source, controller.signal)).rejects.toBeInstanceOf(ClassificationCancelledError);
    if (stage === "pre-abort") expect(h.getApiKey).not.toHaveBeenCalled();
    if (stage !== "provider") expect(h.classify).not.toHaveBeenCalled();
    expect(h.getActiveNoteState).not.toHaveBeenCalled();
  });

  it.each(["__other__", "unknown", "missing", "invalid-probability"])(
    "retains strict/no-match response rejection: %s", async kind => {
      const probabilities: Record<string, unknown> = { "programming/aws": 0.8, "programming/ruby": 0.1, "health/fitness": 0.1 };
      if (kind === "missing") delete probabilities["health/fitness"];
      if (kind === "invalid-probability") probabilities["health/fitness"] = NaN;
      const execute = vi.fn(async () => ({ answers: { destination: { type: "choice",
        choice: kind === "__other__" ? "__other__" : kind === "unknown" ? "Unknown" : "programming/aws", probabilities } } }));
      const h = createService({ classifier: new TypeSafeAdapter("unit-test-only", execute) });
      await expect(h.service.classifyNote(readyNote.note, readyNote.source)).rejects.toBeInstanceOf(InvalidTypeSafeResponseError);
      expect(execute).toHaveBeenCalledOnce();
    },
  );
});
