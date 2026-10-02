import { Notice, Plugin } from "obsidian";

import { CandidateBuilder } from "./classification/candidate-builder";
import { ClassificationService } from "./classification/classification-service";
import { TypeSafeAdapter } from "./classification/typesafe-adapter";
import { NoteService } from "./note-service";
import { NoteMoveService } from "./note-move-service";
import { SecretService } from "./secret-service";
import { loadSettings, type JevaultSettings } from "./settings";
import { SettingsSaveQueue } from "./settings-save-queue";
import { JevaultSettingTab } from "./settings-tab";
import { ClassificationCommand } from "./suggestion/classification-command";
import { ClassificationErrorModal } from "./suggestion/classification-error-modal";
import { SuggestionModal } from "./suggestion/suggestion-modal";
import { SuggestionSession } from "./suggestion/suggestion-session";
import { VaultService } from "./vault-service";
import { ExistingTagSnapshotService } from "./tags/existing-tag-snapshot";
import { TagDiscoveryService } from "./tags/tag-discovery-service";
import { createTagErrorPresentation } from "./tags/tag-error-presentation";
import { TagSuggestionCommand } from "./tags/tag-suggestion-command";
import { TagSuggestionModal } from "./tags/tag-suggestion-modal";
import { TagSuggestionService } from "./tags/tag-suggestion-service";
import { TagApplyPreparationSession } from "./tags/tag-apply-preparation";
import { TagSuggestionGrantIssuer } from "./tags/tag-suggestion-grant";
import { TagApplyService } from "./tags/tag-apply-service";

export default class JevaultPlugin extends Plugin {
  settings: JevaultSettings = loadSettings(undefined);
  noteService!: NoteService;
  secretService!: SecretService;
  vaultService!: VaultService;
  classificationService!: ClassificationService;
  classificationCommand?: ClassificationCommand;
  tagSuggestionCommand?: TagSuggestionCommand;

  async onload(): Promise<void> {
    this.settings = loadSettings(await this.loadData());
    this.noteService = new NoteService(this.app.workspace, this.app.vault);
    // SecretStorage へのアクセスは専用サービスへ閉じ込め、後続の分類処理から差し替え可能にする。
    this.secretService = new SecretService(this.app.secretStorage);
    this.vaultService = new VaultService(this.app.vault);
    this.classificationService = new ClassificationService(
      this.noteService,
      this.vaultService,
      new CandidateBuilder(),
      this.secretService,
      // provider固有クラスの生成はcomposition rootに限定し、application serviceへ漏らさない。
      (apiKey) => new TypeSafeAdapter(apiKey),
      () => this.settings,
    );
    const noteMoveService = new NoteMoveService(this.app.vault, this.app.fileManager);
    this.classificationCommand = new ClassificationCommand({
      classificationService: this.classificationService,
      getActiveNotePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      showLoading: () => {
        const notice = new Notice("Jevault is classifying this note...", 0);
        return { hide: () => notice.hide() };
      },
      showSuggestions: (outcome, ownerSignal) => {
        new SuggestionModal(
          this.app,
          new SuggestionSession(outcome, noteMoveService),
          (message) => {
            new Notice(message);
          },
          ownerSignal,
        ).open();
      },
      showError: (presentation, retry, ownerSignal) => {
        new ClassificationErrorModal(
          this.app,
          presentation,
          retry,
          ownerSignal,
        ).open();
      },
    });
    this.addCommand({
      id: "classify-current-note",
      // Obsidianがplugin名を付与し、Paletteでは「Jevault: Classify current note」と表示する。
      name: "Classify current note",
      callback: () => {
        void this.classificationCommand?.execute();
      },
    });
    const tagApplyService = new TagApplyService(this.app.vault, this.app.fileManager);
    this.tagSuggestionCommand = new TagSuggestionCommand({
      tagSuggestionService: new TagSuggestionService(
        this.noteService,
        new TagDiscoveryService(this.app.vault, this.app.metadataCache),
        this.secretService,
        (apiKey) => new TypeSafeAdapter(apiKey),
        () => this.settings,
      ),
      existingTags: new ExistingTagSnapshotService(this.app.vault, this.app.metadataCache),
      grantIssuer: new TagSuggestionGrantIssuer(this.app.vault),
      startPreparation: () => new TagApplyPreparationSession(
        this.app.vault, this.app.metadataCache, this.app.workspace.getActiveFile(),
      ),
      getActiveNotePath: () => this.app.workspace.getActiveFile()?.path ?? null,
      showLoading: () => {
        const notice = new Notice("Jevault is suggesting tags for this note...", 0);
        return { hide: () => notice.hide() };
      },
      showSuggestions: (outcome, snapshot, ownerSignal, preparation) => {
        new TagSuggestionModal(this.app, outcome, snapshot, ownerSignal, preparation, tagApplyService, (message) => {
          new Notice(message);
        }).open();
      },
      showError: (presentation, retry, ownerSignal) => {
        new ClassificationErrorModal(
          this.app, presentation, retry, ownerSignal, createTagErrorPresentation,
        ).open();
      },
    });
    this.addCommand({
      id: "suggest-tags-for-current-note",
      name: "Suggest tags for current note",
      callback: () => {
        void this.tagSuggestionCommand?.execute();
      },
    });
    const saveQueue = new SettingsSaveQueue(
      async (snapshot) => this.saveData(snapshot),
      () => console.error("Failed to save Jevault settings."),
    );

    this.addSettingTab(
      new JevaultSettingTab(
        this.app,
        this,
        () => this.settings,
        async (update) => {
          this.settings = { ...this.settings, ...update };
          await saveQueue.enqueue(this.settings);
        },
      ),
    );
  }

  onunload(): void {
    this.tagSuggestionCommand?.dispose();
    this.tagSuggestionCommand = undefined;
    this.classificationCommand?.dispose();
    this.classificationCommand = undefined;
  }
}
