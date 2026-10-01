// https://help.obsidian.md/tags のcase-insensitive契約を、確認済みのASCII範囲で比較する。
// Unicode folding・正規化は推測せず、比較用の文字列を保存や既存表記の変更に使わない。
export function isSameTagIdentity(a: string, b: string): boolean {
  const foldAscii = (name: string) => name.replace(/[A-Z]/g, (char) => char.toLowerCase());
  return foldAscii(a) === foldAscii(b);
}
