import type { TFile } from "obsidian";

interface MutationDomain {
  readonly paths: Set<string>;
  readonly files: Set<TFile>;
}

// actual Vault objectで共有し、認可・外部writeの排他・永続化は担当しない。
const domains = new WeakMap<object, MutationDomain>();

/** 比較専用。実際のmutation pathへ変換して使わない。 */
export function vaultMutationPathKey(path: string): string {
  return path.normalize("NFC").toLowerCase();
}

export interface VaultMutationLease {
  /** source解決後、API開始前に同一TFileを同期予約する。失敗時はlease全体を解放する。 */
  bindSourceFile(file: TFile): boolean;
  release(): void;
}

/** 認可後に呼ぶJevault内の排他境界。busyは待たず、全keyを同期的に予約する。 */
export function acquireVaultMutationLease(
  vault: object,
  sourcePath: string,
  targetPath?: string,
  sourceFile?: TFile,
): VaultMutationLease | undefined {
  const keys = [...new Set([sourcePath, ...(targetPath === undefined ? [] : [targetPath])]
    .map(vaultMutationPathKey))];
  const domain = domains.get(vault) ?? { paths: new Set<string>(), files: new Set<TFile>() };
  domains.set(vault, domain);
  // source/targetを同じnamespaceで確認し、衝突時は一つも予約しない。
  if (keys.some(key => domain.paths.has(key)) || (sourceFile !== undefined && domain.files.has(sourceFile))) {
    return undefined;
  }
  keys.forEach(key => domain.paths.add(key));
  let identity = sourceFile;
  if (identity !== undefined) domain.files.add(identity);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    keys.forEach(key => domain.paths.delete(key));
    if (identity !== undefined) domain.files.delete(identity);
  };
  return {
    bindSourceFile(file): boolean {
      if (released) return false;
      if (identity === file) return true;
      if (identity !== undefined || domain.files.has(file)) {
        release();
        return false;
      }
      domain.files.add(file);
      identity = file;
      return true;
    },
    release,
  };
}
