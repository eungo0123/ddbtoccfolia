// src/lib/ddbModifiers.ts
export function getAllModifiers(ddb: any): any[] {
  const m = ddb?.modifiers;

  // 이미 배열이면 그대로
  if (Array.isArray(m)) return m;

  // object면 값들 중 배열만 전부 펼치기
  if (m && typeof m === "object") {
    const out: any[] = [];
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) out.push(...v);
    }
    return out;
  }

  return [];
}
