import { type App, type Menu, type TAbstractFile, TFolder } from "obsidian";

import type { JevaultSettings } from "../settings";
import { OrganizationScope } from "./organization-scope";
import { FolderOrganizerScopeModal } from "./folder-organizer-scope-modal";
import type { TargetFileCollector } from "./target-file-collector";
import type { FolderOrganizerService } from "./folder-organizer-service";
import type { OrganizationReviewService } from "./organization-review-service";
import { OrganizationReviewModal } from "./organization-review-modal";
import type { OrganizationApplyService } from "./organization-apply-service";
import { OrganizationApplyFlow } from "./organization-apply-flow";
import { OrganizationApplyModal } from "./organization-apply-modal";

export class FolderOrganizerEntryController {
  private readonly lifetime = new AbortController();

  constructor(
    private readonly app: App,
    private readonly collector: Pick<TargetFileCollector, "collect">,
    private readonly getSettings: () => Pick<JevaultSettings, "ignoredFolders">,
    private readonly analysis: Pick<FolderOrganizerService, "analyze">,
    private readonly review: Pick<OrganizationReviewService, "prepare">,
    private readonly apply: Pick<OrganizationApplyService, "apply">,
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
          result => {
            const session = this.review.prepare(result, this.lifetime.signal);
            if (!session) return false;
            if (this.lifetime.signal.aborted) { session.dispose(); return false; }
            new OrganizationReviewModal(this.app, session, this.lifetime.signal, owner => {
              const flow = new OrganizationApplyFlow(this.app.vault, owner, this.apply, this.lifetime.signal);
              try { new OrganizationApplyModal(this.app, flow).open(); }
              catch { flow.detach(); }
            }).open();
            return true;
          },
        ).open();
      }));
  }

  dispose(): void {
    this.lifetime.abort();
  }
}
