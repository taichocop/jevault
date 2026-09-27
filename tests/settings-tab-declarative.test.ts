import { Setting, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ui = vi.hoisted(() => ({
  changes: new Map<string, (value: string) => Promise<void>>(),
  secretChange: undefined as ((value: unknown) => Promise<void>) | undefined,
  constructed: [] as string[],
}));

vi.mock("obsidian", () => {
  class Input {
    inputEl = { type: "", min: "", step: "" };
    constructor(private readonly name: string) {}
    setValue(): this { return this; }
    onChange(callback: (value: string) => Promise<void>): this {
      ui.changes.set(this.name, callback);
      return this;
    }
  }

  class Setting {
    name = "";
    controlEl = {};
    constructor() { ui.constructed.push("setting"); }
    setName(name: string): this { this.name = name; return this; }
    setDesc(): this { return this; }
    addText(callback: (input: Input) => void): this {
      callback(new Input(this.name));
      return this;
    }
    addTextArea(callback: (input: Input) => void): this {
      callback(new Input(this.name));
      return this;
    }
  }

  class SecretComponent {
    constructor() { ui.constructed.push("secret"); }
    setValue(): this { return this; }
    onChange(callback: (value: unknown) => Promise<void>): this {
      ui.secretChange = callback;
      return this;
    }
  }

  class PluginSettingTab {
    containerEl = { empty: () => undefined };
  }

  return { Setting, SecretComponent, PluginSettingTab };
});

import { DEFAULT_SETTINGS, type JevaultSettings } from "../src/settings";
import { SettingsSaveQueue } from "../src/settings-save-queue";
import { JevaultSettingTab } from "../src/settings-tab";

function createHarness() {
  let active: JevaultSettings = {
    ...DEFAULT_SETTINGS,
    ignoredFolders: [...DEFAULT_SETTINGS.ignoredFolders],
  };
  const saved: JevaultSettings[] = [];
  const save = vi.fn(async (snapshot: JevaultSettings) => { saved.push(snapshot); });
  const queue = new SettingsSaveQueue(save, vi.fn());
  const update = vi.fn(async (change: Partial<JevaultSettings>) => {
    active = { ...active, ...change };
    await queue.enqueue(active);
  });
  const getSettings = vi.fn(() => active);
  const tab = new JevaultSettingTab({} as App, {} as Plugin, getSettings, update);
  return { tab, saved, save, update, getSettings, get active() { return active; } };
}

function renderDeclarative(tab: JevaultSettingTab): void {
  for (const definition of tab.getSettingDefinitions()) {
    if (!("name" in definition)) continue;
    const setting = new Setting({} as HTMLElement).setName(definition.name);
    if ("render" in definition) definition.render?.(setting, {} as never);
  }
}

beforeEach(() => {
  ui.changes.clear();
  ui.secretChange = undefined;
  ui.constructed.length = 0;
});

describe("dual settings tab", () => {
  it("exposes searchable definitions without constructing UI or changing settings", () => {
    const harness = createHarness();
    const definitions = harness.tab.getSettingDefinitions();
    expect(definitions.map((item: SettingDefinitionItem) => "name" in item ? item.name : "")).toEqual([
      "Privacy and external services",
      "TypeSafe API key",
      "Inbox folder",
      "Number of suggestions",
      "Ignored folders",
    ]);
    expect(ui.constructed).toEqual([]);
    expect(harness.getSettings).not.toHaveBeenCalled();
    expect(harness.update).not.toHaveBeenCalled();
    expect(harness.save).not.toHaveBeenCalled();
  });

  for (const mode of ["legacy", "declarative"] as const) {
    it(`${mode} uses the queue for valid changes and rejects invalid counts`, async () => {
      const harness = createHarness();
      if (mode === "legacy") harness.tab.display();
      else renderDeclarative(harness.tab);

      await ui.changes.get("Inbox folder")?.("Other Inbox");
      for (const invalid of ["", "0", "-1", "1.5", "abc"]) {
        await ui.changes.get("Number of suggestions")?.(invalid);
      }
      expect(harness.active.suggestionCount).toBe(3);
      await ui.changes.get("Number of suggestions")?.("4");
      await ui.changes.get("Ignored folders")?.("Templates\n\n Attachments \n");
      await ui.secretChange?.("test-secret-reference");
      expect(harness.active).toEqual({
        apiKeySecretName: "test-secret-reference",
        inboxPath: "Other Inbox",
        suggestionCount: 4,
        ignoredFolders: ["Templates", "Attachments"],
      });
      expect(harness.saved.at(-1)).toEqual(harness.active);
      expect(harness.save).toHaveBeenCalledTimes(4);

      await ui.secretChange?.(null);
      expect(harness.active.apiKeySecretName).toBe("");
      expect(harness.saved.at(-1)?.apiKeySecretName).toBe("");
    });
  }

  it("keeps rapid declarative updates in save order", async () => {
    const harness = createHarness();
    renderDeclarative(harness.tab);
    const changeInbox = ui.changes.get("Inbox folder");
    expect(changeInbox).toBeDefined();
    if (changeInbox === undefined) throw new Error("Missing Inbox control");

    await Promise.all([changeInbox("First"), changeInbox("Second")]);
    expect(harness.saved.map((snapshot) => snapshot.inboxPath)).toEqual([
      "First", "Second",
    ]);
    expect(harness.active.inboxPath).toBe("Second");
  });
});
