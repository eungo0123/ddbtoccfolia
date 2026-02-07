// src/lib/ddbFeatures.ts

/**
 * D&D Beyond 캐릭터 raw에서 "피쳐(배경/클래스/피트 등)" 이름 목록만 뽑아낸다.
 */

// ✅ [추가] 출력하고 싶지 않은 시스템용/내부용 피트 이름들
const IGNORED_NAMES = new Set([
  "Ability Score Improvement", // 능력치 상승은 굳이 텍스트로 안 봐도 됨
  "Dark Bargain",
  "Hero's Journey Boon",
  "Tortle Protector", // 종족 특성 중 중복되는 것들
  "Primal Knowledge",
  "Optional Class Features",
]);

function pickName(x: any): string {
  const n = x?.definition?.name ?? x?.name ?? x?.label ?? "";
  const s = String(n ?? "").trim();
  
  // 차단 목록에 있거나, 이름이 너무 짧으면 무시
  if (IGNORED_NAMES.has(s)) return "";
  if (s.length < 2) return "";
  
  return s;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean)));
}

function normalizeManeuverName(name: string): string {
  let n = name.trim();

  // "Maneuvers: Precision Attack" → "Precision Attack"
  n = n.replace(/^Maneuvers:\s*/i, "").trim();

  // 흔히 섞이는 상위 피쳐/잡음 제거
  const ban = new Set([
    "Combat Superiority",
    "Maneuvers",
    "Superiority Dice",
    "Combat Superiority (Fighter)",
  ]);
  if (ban.has(n)) return "";

  if (n.length < 3) return "";
  return n;
}

function deepCollectManeuverNames(root: any): string[] {
  const out = new Set<string>();
  const seen = new Set<any>();

  const isNoise = (name: string) => {
    const ban = new Set([
      "Combat Superiority",
      "Maneuvers",
      "Superiority Dice",
      "Combat Superiority (Fighter)",
    ]);
    return ban.has(name);
  };

  const normalize = (name: string) => {
    let n = String(name ?? "").trim();
    n = n.replace(/^Maneuvers:\s*/i, "").trim(); // "Maneuvers: X" → "X"
    if (!n) return "";
    if (isNoise(n)) return "";
    if (n.length < 3) return "";
    return n;
  };

  const walk = (node: any, parentKey: string, inManeuverCtx: boolean) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const pk = (parentKey || "").toLowerCase();

    const nodeName = pickName(node); 
    const nameLower = nodeName.toLowerCase();

    const def = node?.definition ?? node;
    const hay = [
      def?.featureType,
      def?.type,
      def?.subType,
      def?.category,
      def?.entityType,
      def?.friendlySubtypeName,
      def?.snippet,
      def?.description,
    ]
      .filter(Boolean)
      .map((v: any) => String(v).toLowerCase())
      .join(" | ");

    const nextCtx =
      inManeuverCtx ||
      pk.includes("maneuver") ||
      nameLower === "maneuvers" ||
      nameLower.startsWith("maneuvers:") ||
      hay.includes("maneuver");

    if (nodeName) {
      if (nameLower.startsWith("maneuvers:")) {
        const n = normalize(nodeName);
        if (n) out.add(n);
      } else if (nextCtx) {
        const n = normalize(nodeName);
        if (n) out.add(n);
      }
    }

    if (Array.isArray(node)) {
      for (const v of node) walk(v, parentKey, nextCtx);
      return;
    }

    for (const [k, v] of Object.entries(node)) {
      walk(v, k, nextCtx);
    }
  };

  walk(root, "", false);
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}


export type FeatureLists = {
  background?: string;
  classes: string[];
  feats: string[];
  classFeatures: string[];
  maneuvers: string[];
};

export function extractFeatureLists(ddb: any): FeatureLists {
  const out: FeatureLists = { classes: [], feats: [], classFeatures: [], maneuvers: [] };

  // Background
  const bg = pickName(ddb?.background);
  if (bg) out.background = bg;

  // Classes
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  for (const c of classes) {
    const cn =
      c?.definition?.name ??
      c?.class?.definition?.name ??
      c?.class?.name ??
      c?.name;
    const lvl = Number(c?.level ?? 0);
    const s = String(cn ?? "").trim();
    if (!s) continue;
    out.classes.push(lvl > 0 ? `${s} ${lvl}` : s);

    // Class features
    const cfPools = [
      c?.classFeatures,
      // c?.features, // 중복 유발하여 제거
      c?.definition?.classFeatures,
    ];
    for (const p of cfPools) {
      if (Array.isArray(p)) {
        for (const f of p) {
          const fn = pickName(f);
          if (fn) out.classFeatures.push(fn);
        }
      }
    }
  }

  // ✅ [수정] Feats: 불필요한 곳(featChoices, options)을 뒤지지 않고 '진짜 피트'만 봅니다.
  // ddb.feats가 가장 정확하며, Variant Human 보너스 피트도 여기에 들어있습니다.
  const featsRaw = ddb?.feats;
  if (Array.isArray(featsRaw)) {
    for (const f of featsRaw) {
      const fn = pickName(f);
      if (fn) out.feats.push(fn);
    }
  }

  // Maneuvers
  out.maneuvers = Array.from(
    new Set(
      deepCollectManeuverNames(ddb)
        .map(normalizeManeuverName)
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));


  out.classes = uniq(out.classes);
  out.feats = uniq(out.feats);
  
  // 중복 제거: 만약 피트 이름이 클래스 피쳐에도 있다면(드물지만), 피트 쪽을 우선시하고 싶다면 여기서 필터링 가능
  // 지금은 그냥 둡니다.
  out.classFeatures = uniq(out.classFeatures);

  return out;
}

export function buildFeatureListKo(lists: any): string {
  const lines: string[] = [];

  const pushSection = (title: string, items?: string[] | string) => {
    if (!items) return;

    if (typeof items === "string") {
      const s = items.trim();
      if (!s) return;
      lines.push(`[${title}]`);
      lines.push(s);
      lines.push("");
      return;
    }

    if (!Array.isArray(items) || items.length === 0) return;
    lines.push(`[${title}]`);
    for (const name of items) {
      if (typeof name === "string" && name.trim()) lines.push(name.trim());
    }
    lines.push("");
  };

  pushSection("배경", lists.background);
  pushSection("클래스", lists.classes);
  pushSection("피트", lists.feats); // 이제 깔끔하게 나올 겁니다
  pushSection("전투 기교", lists.maneuvers);
  pushSection("클래스 피쳐", lists.classFeatures);

  return lines.join("\n").trim();
}