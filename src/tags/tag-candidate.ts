export interface TagCandidate {
  /** 同じ候補集合で安定する内部ID。集合が変わると変化し得るため永続化しない。 */
  id: string;
  /** getAllTagsの返り値をそのまま保持し、`#`・階層・大小文字を独自変換しない。 */
  name: string;
  description?: string;
}
