import { keywordGroupKey } from "./keyword-groups.mjs";

export const DEFAULT_POSITIVE_KEYWORD_WEIGHT = 2;

export function clampPositiveKeywordWeight(value, fallback = DEFAULT_POSITIVE_KEYWORD_WEIGHT) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

export function positiveKeywordWeight(weights, group) {
  if (!weights || typeof weights !== "object" || Array.isArray(weights)) {
    return DEFAULT_POSITIVE_KEYWORD_WEIGHT;
  }
  if (Object.hasOwn(weights, group)) return clampPositiveKeywordWeight(weights[group]);
  const groupKey = keywordGroupKey(group);
  const match = Object.entries(weights).find(([candidate]) => keywordGroupKey(candidate) === groupKey);
  return match
    ? clampPositiveKeywordWeight(match[1])
    : DEFAULT_POSITIVE_KEYWORD_WEIGHT;
}

export function normalizePositiveKeywordWeights(weights, groups) {
  return Object.fromEntries(
    groups.map((group) => [group, positiveKeywordWeight(weights, group)]),
  );
}
