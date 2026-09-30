import type { App } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { fixtureSource } from "./helpers/note-source";
interface FakeElement {
  children: FakeElement[];
  disabled: boolean;
  text: string;
  tag: string;
  click(): void;
}

vi.mock("obsidian", () => {
  class Element {
    children: Element[] = [];
    disabled = false;
    text = "";
    tag = "";
    private clickHandler: (() => void) | undefined;

    empty(): void {
      this.children = [];
    }

    createEl(tag: string, options?: { text?: string }): Element {
      const child = new Element();
      child.tag = tag;
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

import { TagSuggestionModal } from "../src/tags/tag-suggestion-modal";
import type { TagSuggestionServiceResult } from "../src/tags/tag-suggestion-service";

const outcome: TagSuggestionServiceResult = {
  status: "success", source: fixtureSource(), noteTitle: "Synthetic <note>",
  suggestions: [
    { tagId: "tag_001", tagName: "#aws", choice: "match", matchProbability: 0.96 },
    { tagId: "tag_002", tagName: "#cloud", choice: "match", matchProbability: 0.88 },
    { tagId: "tag_003", tagName: "#programming/aws", choice: "match", matchProbability: 0.82 },
  ],
};
function texts(element: FakeElement): string[] {
  return [element.text, ...element.children.flatMap(texts)];
}
describe("TagSuggestionModal", () => {
  it("preserves names, order, probability and already-on-note rows with only Close", () => {
    const owner = new AbortController();
    const modal = new TagSuggestionModal({} as App, outcome, { status: "available", names: ["#aws", "#CLOUD"] }, owner.signal);
    modal.open();
    const content = modal.contentEl as unknown as FakeElement;
    expect(texts(content).filter(Boolean)).toEqual([
      "Suggested tags for “Synthetic <note>”",
      "#aws — 96.0% — Already on note", "#cloud — 88.0%", "#programming/aws — 82.0%", "Close",
    ]);
    const all = (element: FakeElement): FakeElement[] => [element, ...element.children.flatMap(all)];
    expect(all(content).filter(element => ["button", "input", "select", "textarea"].includes(element.tag)).map(element => [element.tag, element.text])).toEqual([["button", "Close"]]);
    content.children.at(-1)!.click();
    expect(content.children).toEqual([]);
  });
  it("does not re-sort service order", () => {
    const modal = new TagSuggestionModal({} as App, { ...outcome, suggestions: [...outcome.suggestions].reverse() }, { status: "available", names: [] }, new AbortController().signal);
    modal.open();
    const rows = texts(modal.contentEl as unknown as FakeElement).filter(text => text.startsWith("#"));
    expect(rows[0]).toBe("#programming/aws — 82.0%");
  });
  it("shows normal empty state", () => {
    const modal = new TagSuggestionModal({} as App, { ...outcome, suggestions: [] }, { status: "available", names: [] }, new AbortController().signal);
    modal.open();
    expect(texts(modal.contentEl as unknown as FakeElement)).toContain("No matching tags were suggested for this note.");
  });
  it("shows unknown state without claiming tags are absent", () => {
    const modal = new TagSuggestionModal({} as App, outcome, { status: "unavailable" }, new AbortController().signal);
    modal.open();
    const rendered = texts(modal.contentEl as unknown as FakeElement).join(" ");
    expect(rendered).toContain("Existing tags on this note are unknown because metadata is unavailable.");
    expect(rendered).not.toContain("Already on note");
  });
  it("closes on unload and cannot reopen with an aborted owner", () => {
    const owner = new AbortController();
    const modal = new TagSuggestionModal({} as App, outcome, { status: "available", names: [] }, owner.signal);
    modal.open();
    owner.abort();
    expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
    modal.open();
    expect((modal.contentEl as unknown as FakeElement).children).toEqual([]);
  });
});
