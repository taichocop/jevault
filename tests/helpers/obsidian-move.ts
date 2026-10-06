// Network-free Obsidian boundary and minimal modal DOM used only by synthetic tests.
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  constructor(path: string) {
    this.path = path;
    this.name = path.slice(path.lastIndexOf("/") + 1);
    const dot = this.name.lastIndexOf(".");
    this.basename = this.name.slice(0, dot);
    this.extension = this.name.slice(dot + 1);
  }
}
export class TFolder {
  children: (TFile | TFolder)[] = [];
  name: string;
  constructor(public path: string) { this.name = path.split("/").at(-1)!; }
}
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "").trim();
}
export class Element {
  children: Element[] = [];
  disabled = false;
  text: string;
  editable = false;
  ownerDocument: { activeElement: Element | null };
  private handlers = new Map<string, (event: Partial<MouseEvent> & { detail: number }) => void>();
  constructor(public tag = "div", text = "", doc = { activeElement: null as Element | null }) {
    this.text = text;
    this.ownerDocument = doc;
  }
  createEl(tag: string, options?: { text?: string }): Element {
    const child = new Element(tag, options?.text, this.ownerDocument);
    this.children.push(child);
    return child;
  }
  setText(text: string): void { this.text = text; }
  empty(): void { this.children = []; this.ownerDocument.activeElement = null; }
  addEventListener(event: string, handler: (event: Partial<MouseEvent> & { detail: number }) => void): void { this.handlers.set(event, handler); }
  // Deliberately invoke stale/disabled callbacks to verify the application guard too.
  click(detail = 1, modifiers: Partial<Pick<MouseEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">> = {}): void {
    this.handlers.get("click")?.({ detail, ...modifiers });
  }
  focus(): void { this.ownerDocument.activeElement = this; }
  closest(): Element | null { return this.editable ? this : null; }
  all(): Element[] { return [this, ...this.children.flatMap((child) => child.all())]; }
}
class Scope {
  active = false;
  handlers = new Map<string, (event: KeyboardEvent) => unknown>();
  register(_modifiers: string[], key: string, handler: (event: KeyboardEvent) => unknown): void {
    this.handlers.set(key, handler);
  }
  press(key: string, options: Partial<KeyboardEvent> = {}): void {
    if (!this.active) return;
    this.handlers.get(key)?.({ key, ...options } as KeyboardEvent);
  }
}
export class Modal {
  contentEl = new Element();
  scope = new Scope();
  onOpen(): void {}
  onClose(): void {}
  constructor() { this.scope.register([], "Escape", () => this.close()); }
  open(): void { this.scope.active = true; this.onOpen(); }
  close(): void { this.scope.active = false; this.onClose(); }
}
export class App {}
