export function normalizeText(value) {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function keywordAliases(group) {
  const seen = new Set();
  return String(group)
    .split("|")
    .map((alias) => alias.trim())
    .filter((alias) => {
      const key = alias.toLocaleLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function canonicalizeKeywordGroup(group) {
  return keywordAliases(group).join(" | ");
}

export function keywordGroupKey(group) {
  return [...new Set(keywordAliases(group).map(normalizeText))].sort().join("|");
}

export function keywordGroupMatches(text, group) {
  const normalizedText = normalizeText(text);
  return keywordAliases(group).some((alias) => {
    const normalizedAlias = normalizeText(alias);
    return normalizedAlias.length > 0 && normalizedText.includes(normalizedAlias);
  });
}
