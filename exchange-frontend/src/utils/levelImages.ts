const normalizeLevelNumber = (levelCode?: string | null, levelRank?: number | null) => {
  const codeMatch = String(levelCode ?? "")
    .trim()
    .toLowerCase()
    .match(/lv\s*(\d+)/);
  if (codeMatch) {
    const parsed = Number(codeMatch[1]);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(10, parsed));
  }

  const rank = Number(levelRank ?? 0);
  if (Number.isFinite(rank)) return Math.max(0, Math.min(10, rank));
  return 0;
};

export const getLevelImageSrc = (levelCode?: string | null, levelRank?: number | null) => {
  const levelNumber = normalizeLevelNumber(levelCode, levelRank);
  return levelNumber === 0 ? "/level/lv0.jpeg" : `/level/lv${levelNumber}.jpg`;
};

export const getLevelLabel = (levelCode?: string | null, levelRank?: number | null) => {
  const normalizedCode = String(levelCode ?? "").trim();
  if (normalizedCode) return normalizedCode.toUpperCase();
  return `LV${normalizeLevelNumber(levelCode, levelRank)}`;
};
