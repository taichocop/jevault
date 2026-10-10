export type RulesetApi = (endpoint: string, paginate?: boolean) => string;
export function parseRulesetPages(text: string): number[];
export function isProtectedRuleset(value: unknown, expectedId: number): boolean;
export function readRulesetApi(endpoint: string, paginate?: boolean): string;
export function requireProtectedReleaseTags(api?: RulesetApi): number[];
