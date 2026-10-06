import { type App, type Menu, type TAbstractFile, TFolder } from "obsidian";

import type { JevaultSettings } from "../settings";
import { OrganizationScope } from "./organization-scope";
import { FolderOrganizerScopeModal } from "./folder-organizer-scope-modal";
import type { TargetFileCollector } from "./target-file-collector";
import type { FolderOrganizerService } from "./folder-organizer-service";

export class FolderOrganizerEntryController {
  private readonly lifetime = new AbortController();

  constructor(
    private readonly app: App,
    private readonly collector: Pick<TargetFileCollector, "collect">,
    private readonly getSettings: () => Pick<JevaultSettings, "ignoredFolders">,
    private readonly analysis: Pick<FolderOrganizerService, "analyze">,
  ) {}

  addToMenu(menu: Menu, file: TAbstractFile): void {
    if (this.lifetime.signal.aborted || !(file instanceof TFolder)) return;
    menu.addItem(item => item
      .setTitle("Jevault: Organize notes in this folder")
      .onClick(() => {
        if (this.lifetime.signal.aborted) return;
        // Modal表示後のrename/moveで、選択時のidentity/pathを再定義しない。
        const direct = new OrganizationScope(file, false);
        const recursive = new OrganizationScope(file, true);
        new FolderOrganizerScopeModal(
          this.app, direct, recursive, this.collector, this.getSettings, this.lifetime.signal, this.analysis,
        ).open();
      }));
  }

  dispose(): void {
    this.lifetime.abort();
  }
}
