import { TagSuggestionGrantIssuer } from "../src/tags/tag-suggestion-grant";
import { fixtureSource } from "./helpers/note-source";
import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";

interface FakeElement {
  children: FakeElement[];
  disabled: boolean;
  text: string;
  click(): void;
}

vi.mock("obsidian", () => {
  class Element {
    children: Element[] = [];
    disabled = false;
    text = "";
    private clickHandler: (() => void) | undefined;

    empty(): void {
      this.children = [];
    }

    createEl(_tag: string, options?: { text?: string }): Element {
      const child = new Element();
      child.text = options?.text ?? "";
      this.children.push(child);
      return child;
    }

    addEventListener(event: string, handler: () => void): void {
      if (event === "click") {
        this.clickHandler = handler;
      }
    }

    click(): void {
      this.clickHandler?.();
    }
  }

  class Modal {
    contentEl = new Element();

    open(): void {
      (this as unknown as { onOpen(): void }).onOpen();
    }

    close(): void {
      (this as unknown as { onClose(): void }).onClose();
    }
  }

  return { App: class {}, Modal };
});

import {
  ClassificationErrorModal,
  type RetryResult,
} from "../src/suggestion/classification-error-modal";
import { TagSuggestionCommand } from "../src/tags/tag-suggestion-command";
import { createTagErrorPresentation } from "../src/tags/tag-error-presentation";
import { NetworkError } from "../src/classification/classification-errors";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function button(modal: ClassificationErrorModal, text: string): FakeElement {
  const contentEl = modal.contentEl as unknown as FakeElement;
  const result = contentEl.children.find((child) => child.text === text);
  if (result === undefined) {
    throw new Error(`Missing ${text} button`);
  }
  return result;
}

describe("ClassificationErrorModal", () => {
  it("disables Retry while pending and renders the latest failure", async () => {
    const retryResult = deferred<{
      status: "failure";
      presentation: { message: string; retryable: boolean };
    }>();
    const retry = vi.fn(() => retryResult.promise);
    const modal = new ClassificationErrorModal(
      {} as App,
      {
        message: "Jevault couldn't suggest tags for this note.\nPlease try again.",
        retryable: true,
      },
      retry,
    );
    modal.open();

    const retryButton = button(modal, "Retry");
    retryButton.click();
    retryButton.click();

    expect(retry).toHaveBeenCalledOnce();
    expect(retryButton.disabled).toBe(true);

    retryResult.resolve({
      status: "failure",
      presentation: {
        message: "Open a Markdown note before running Jevault.",
        retryable: false,
      },
    });
    await retryResult.promise;
    await Promise.resolve();

    const contentEl = modal.contentEl as unknown as FakeElement;
    expect(contentEl.children.map((child) => child.text)).toContain(
      "Open a Markdown note before running Jevault.",
    );
    expect(contentEl.children.map((child) => child.text)).not.toContain("Retry");
    expect(contentEl.children.map((child) => child.text)).toContain("Close");
  });
});

const successfulClassification: TagSuggestionServiceResult = {
  status: "success",
  source: fixtureSource(),
  noteTitle: "Synthetic fixture",
  suggestions: [{ tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.9 }],
};

function createIntegratedCommand() {
  const pending = deferred<TagSuggestionServiceResult>();
  const suggestForActiveNote = vi
    .fn<(signal?: AbortSignal) => Promise<TagSuggestionServiceResult>>()
    .mockRejectedValueOnce(new NetworkError())
    .mockImplementation(() => pending.promise);
  const hide = vi.fn();
  const showSuggestions = vi.fn();
  let modal!: ClassificationErrorModal;
  const showError = vi.fn<(
    presentation: { message: string; retryable: boolean },
    retry: ((signal?: AbortSignal) => Promise<RetryResult>) | undefined,
    ownerSignal: AbortSignal,
  ) => void>((presentation, retry, ownerSignal) => {
    modal = new ClassificationErrorModal({} as App, presentation, retry, ownerSignal, createTagErrorPresentation);
    modal.open();
  });
  const command = new TagSuggestionCommand({
    grantIssuer: new TagSuggestionGrantIssuer({ getFileByPath: () => null }),
    startPreparation: () => ({ state: { status: "unavailable", reason: "freshness-unverified" }, prepare: () => undefined, dispose: () => undefined }),
    existingTags: { snapshot: () => ({ status: "available", names: [] }) },
    tagSuggestionService: { suggestForActiveNote },
    getActiveNotePath: () => "Fixtures/Synthetic.md",
    showLoading: () => ({ hide }),
    showSuggestions,
    showError,
  });
  return {
    command, suggestForActiveNote, hide, pending, showSuggestions, showError,
    getModal: () => modal,
  };
}

async function flushCompletion(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
}

describe("TagSuggestionCommand and ClassificationErrorModal lifecycle", () => {
  it("shows suggestions after an active Retry succeeds", async () => {
    const { command, suggestForActiveNote, pending, showSuggestions, showError, hide, getModal } =
      createIntegratedCommand();
    await command.execute();
    const modal = getModal();
    button(modal, "Retry").click();

    pending.resolve(successfulClassification);
    await flushCompletion();

    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    expect(showError).toHaveBeenCalledOnce();
    expect(showSuggestions).toHaveBeenCalledWith(
      successfulClassification,
      { status: "available", names: [] },
      expect.any(AbortSignal),
      expect.objectContaining({ dispose: expect.any(Function) }),
    );
    expect(hide).toHaveBeenCalledTimes(2);
    expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
  });

  it("does not start duplicate Tag Suggest from repeated Retry clicks", async () => {
    const { command, suggestForActiveNote, pending, showSuggestions, getModal } =
      createIntegratedCommand();
    await command.execute();
    const retryButton = button(getModal(), "Retry");

    retryButton.click();
    retryButton.click();
    expect(retryButton.disabled).toBe(true);
    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);

    pending.resolve(successfulClassification);
    await flushCompletion();
    expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
    expect(showSuggestions).toHaveBeenCalledOnce();
  });

  it.each(["close", "unload"] as const)(
    "aborts Retry on %s and suppresses a late success and finally redraw",
    async (action) => {
      const { command, suggestForActiveNote, pending, showSuggestions, showError, hide, getModal } =
        createIntegratedCommand();
      await command.execute();
      const modal = getModal();
      const retryButton = button(modal, "Retry");
      retryButton.click();
      retryButton.click();
      expect(suggestForActiveNote).toHaveBeenCalledTimes(2);
      const signal = suggestForActiveNote.mock.calls[1]![0]!;
      expect(signal.aborted).toBe(false);

      if (action === "close") {
        button(modal, "Close").click();
      } else {
        command.dispose();
      }
      expect(signal.aborted).toBe(true);
      expect(hide).toHaveBeenCalledTimes(2);
      const empty = vi.spyOn(modal.contentEl, "empty");
      const createEl = vi.spyOn(modal.contentEl, "createEl");
      pending.resolve(successfulClassification);
      await flushCompletion();

      expect(showSuggestions).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledOnce();
      expect(empty).not.toHaveBeenCalled();
      expect(createEl).not.toHaveBeenCalled();
      expect(hide).toHaveBeenCalledTimes(2);
      expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
    },
  );

  it.each(["close", "unload"] as const)(
    "consumes a late Retry rejection after %s without error or finally redraw",
    async (action) => {
      const { command, suggestForActiveNote, pending, showSuggestions, showError, getModal } =
        createIntegratedCommand();
      await command.execute();
      const modal = getModal();
      button(modal, "Retry").click();
      if (action === "close") {
        modal.close();
      } else {
        command.dispose();
      }
      expect(suggestForActiveNote.mock.calls[1]![0]!.aborted).toBe(true);
      const empty = vi.spyOn(modal.contentEl, "empty");
      const createEl = vi.spyOn(modal.contentEl, "createEl");
      pending.reject(new NetworkError());
      await flushCompletion();

      expect(showSuggestions).not.toHaveBeenCalled();
      expect(showError).toHaveBeenCalledOnce();
      expect(empty).not.toHaveBeenCalled();
      expect(createEl).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "keeps a reopened Modal's Retry locked when the replaced operation completes by %s",
    async (completion) => {
      const { command, suggestForActiveNote, pending, showSuggestions, getModal } =
        createIntegratedCommand();
      const replacement = deferred<TagSuggestionServiceResult>();
      await command.execute();
      const modal = getModal();
      button(modal, "Retry").click();
      const oldSignal = suggestForActiveNote.mock.calls[1]![0]!;
      modal.close();
      modal.open();
      suggestForActiveNote.mockImplementationOnce(() => replacement.promise);
      const currentButton = button(modal, "Retry");
      currentButton.click();
      expect(oldSignal.aborted).toBe(true);
      expect(suggestForActiveNote).toHaveBeenCalledTimes(3);
      const currentSignal = suggestForActiveNote.mock.calls[2]![0]!;
      expect(currentSignal.aborted).toBe(false);
      const empty = vi.spyOn(modal.contentEl, "empty");

      if (completion === "resolve") {
        pending.resolve(successfulClassification);
      } else {
        pending.reject(new NetworkError());
      }
      await flushCompletion();
      expect(empty).not.toHaveBeenCalled();
      expect(currentButton.disabled).toBe(true);
      expect(showSuggestions).not.toHaveBeenCalled();
      currentButton.click();
      await command.execute();
      expect(suggestForActiveNote).toHaveBeenCalledTimes(3);
      expect(currentSignal.aborted).toBe(false);

      replacement.resolve(successfulClassification);
      await flushCompletion();
      expect(showSuggestions).toHaveBeenCalledOnce();
      expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
    },
  );

  it("invalidates an existing Retry when onOpen replaces its UI generation", async () => {
    const { command, suggestForActiveNote, pending, getModal } = createIntegratedCommand();
    await command.execute();
    const modal = getModal();
    button(modal, "Retry").click();
    const oldSignal = suggestForActiveNote.mock.calls[1]![0]!;
    modal.onOpen();
    expect(oldSignal.aborted).toBe(true);
    const empty = vi.spyOn(modal.contentEl, "empty");
    pending.reject(new NetworkError());
    await flushCompletion();
    expect(empty).not.toHaveBeenCalled();
    expect(button(modal, "Retry").disabled).toBe(false);
    command.dispose();
  });

  it("does not reopen UI or start a Retry after command unload", async () => {
    const { command, suggestForActiveNote, getModal } = createIntegratedCommand();
    await command.execute();
    const modal = getModal();
    const staleButton = button(modal, "Retry");
    command.dispose();
    modal.open();
    staleButton.click();
    await flushCompletion();
    expect(suggestForActiveNote).toHaveBeenCalledOnce();
    expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
  });
});

it("maps an unexpected Retry throw with the injected Tag mapper", async () => {
  const retry = vi.fn(async () => { throw new Error("synthetic private detail"); });
  const modal = new ClassificationErrorModal({} as App, createTagErrorPresentation(new NetworkError()), retry, undefined, createTagErrorPresentation);
  modal.open();
  expect(retry).not.toHaveBeenCalled();
  button(modal, "Retry").click();
  await flushCompletion();
  const texts = (modal.contentEl as unknown as FakeElement).children.map(child => child.text);
  expect(texts).toContain("Jevault couldn't suggest tags for this note.");
  expect(texts.join(" ")).not.toMatch(/classify|destination folders|synthetic private detail/);
  expect(texts).not.toContain("Retry");
});

it("renders Tag-specific presentation after an explicit Retry fails again", async () => {
  const h = createIntegratedCommand();
  await h.command.execute();
  expect(h.suggestForActiveNote).toHaveBeenCalledOnce();
  button(h.getModal(), "Retry").click();
  h.pending.reject(new NetworkError());
  await flushCompletion();
  const texts = (h.getModal().contentEl as unknown as FakeElement).children.map(child => child.text);
  expect(texts).toEqual(["Jevault", "Jevault couldn't suggest tags for this note.", "Please try again.", "Retry", "Close"]);
  expect(h.suggestForActiveNote).toHaveBeenCalledTimes(2);
  expect(h.hide).toHaveBeenCalledTimes(2);
  expect(h.showSuggestions).not.toHaveBeenCalled();
  h.command.dispose();
});
