import {
  App,
  Plugin,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";

import {
  parseIgnoredFolders,
  parseSuggestionCount,
  type JevaultSettings,
} from "./settings";

type SettingsUpdate = Partial<
  Pick<
    JevaultSettings,
    "apiKeySecretName" | "inboxPath" | "suggestionCount" | "ignoredFolders"
  >
>;

type JevaultSettingDefinition = {
  name: string;
  desc: string;
} & ({ render: (setting: Setting) => void } | { render?: never });

/** Jevault の設定を編集し、機密値は Obsidian SecretStorage に委ねる Settings タブ。 */
export class JevaultSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    plugin: Plugin,
    private readonly getSettings: () => JevaultSettings,
    private readonly updateSettings: (update: SettingsUpdate) => Promise<void>,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    // 検索登録時にも呼ばれるため、ここでは UI・保存・SecretStorage へ触れない。
    return this.getDefinitions();
  }

  private getDefinitions(): JevaultSettingDefinition[] {
    return [
      {
        name: "Privacy and external services",
        desc: "When you explicitly run “Jevault: Classify current note”, the active note title, Vault-relative path, full Markdown note body, and candidate folder paths are sent to TypeSafe. Jevault does not send note data in the background.",
      },
      {
        name: "TypeSafe API key",
        desc: "Select the Obsidian secret that contains your TypeSafe API key.",
        render: (setting) => this.renderApiKey(setting),
      },
      {
        name: "Inbox folder",
        desc: "Vault-relative path used to exclude the Inbox from suggestions.",
        render: (setting) => this.renderInboxPath(setting),
      },
      {
        name: "Number of suggestions",
        desc: "Number of folder suggestions to show.",
        render: (setting) => this.renderSuggestionCount(setting),
      },
      {
        name: "Ignored folders",
        desc: "Vault-relative folder paths to ignore, one per line.",
        render: (setting) => this.renderIgnoredFolders(setting),
      },
    ];
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();
    for (const definition of this.getDefinitions()) {
      const setting = new Setting(containerEl)
        .setName(definition.name)
        .setDesc(definition.desc);
      definition.render?.(setting);
    }
  }

  private renderApiKey(setting: Setting): void {
    // SecretComponent は値を露出せず、設定には SecretStorage 上の参照名だけを渡す。
    new SecretComponent(this.app, setting.controlEl)
      .setValue(this.getSettings().apiKeySecretName)
      .onChange(async (value) => {
        // Obsidian の解除操作は型定義と異なり null を返し得るため、設定へ入る前に空文字へ戻す。
        const apiKeySecretName = typeof value === "string" ? value : "";
        await this.updateSettings({ apiKeySecretName });
      });
  }

  private renderInboxPath(setting: Setting): void {
    setting.addText((text) =>
      text.setValue(this.getSettings().inboxPath).onChange(async (value) => {
        await this.updateSettings({ inboxPath: value });
      }),
    );
  }

  private renderSuggestionCount(setting: Setting): void {
    setting.addText((text) => {
      text.inputEl.type = "number";
      text.inputEl.min = "1";
      text.inputEl.step = "1";
      text.setValue(String(this.getSettings().suggestionCount)).onChange(async (value) => {
        const suggestionCount = parseSuggestionCount(value);

        // 未入力途中の値を保存して設定を壊さない。上限は Issue で未定義のため設けない。
        if (suggestionCount === undefined) {
          return;
        }

        await this.updateSettings({ suggestionCount });
      });
    });
  }

  private renderIgnoredFolders(setting: Setting): void {
    setting.addTextArea((text) =>
      text
        .setValue(this.getSettings().ignoredFolders.join("\n"))
        .onChange(async (value) => {
          // 空行は除外し、後続処理へ意味のない候補を渡さない。
          const ignoredFolders = parseIgnoredFolders(value);

          await this.updateSettings({ ignoredFolders });
        }),
    );
  }
}
