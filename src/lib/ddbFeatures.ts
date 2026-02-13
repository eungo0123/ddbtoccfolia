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
  "Hit Points",
  "Proficiencies",
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

// ... (Maneuver 관련 함수들은 기존과 동일하므로 생략하거나 그대로 둡니다) ...
// (지면 관계상 아래 deepCollectManeuverNames, normalizeManeuverName은 
//  기존 코드 그대로 유지한다고 가정하고 extractFeatureLists 부분만 집중적으로 수정합니다.)

function normalizeManeuverName(name: string): string {
  let n = name.trim();
  n = n.replace(/^Maneuvers:\s*/i, "").trim();
  const ban = new Set([
    "Combat Superiority", "Maneuvers", "Superiority Dice", "Combat Superiority (Fighter)",
  ]);
  if (ban.has(n)) return "";
  if (n.length < 3) return "";
  return n;
}

function deepCollectManeuverNames(root: any): string[] {
  // ... (기존 코드와 동일) ...
  // 파일 내용을 줄이기 위해 여기서는 생략하지만, 원본 코드를 그대로 쓰시면 됩니다.
  // 아래에 extractFeatureLists 로직 안에서 호출됩니다.
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
    n = n.replace(/^Maneuvers:\s*/i, "").trim(); 
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
    const level = Number(c?.level ?? 0); // ✅ 현재 클래스의 레벨 확인
    const s = String(cn ?? "").trim();
    if (!s) continue;
    
    // 클래스 이름 (ex: Fighter 5)
    out.classes.push(level > 0 ? `${s} ${level}` : s);

    // ============================================================
    // 🔥 [수정된 핵심 로직] 피쳐 가져오기 + 레벨 체크
    // ============================================================
    
    // 1. 가져올 후보군 (Pool) 구성
    // - classFeatures: 캐릭터에게 할당된 인스턴스 피쳐 (보통 선택지가 있는 것들)
    // - definition.classFeatures: 해당 클래스의 전체 피쳐 목록
    // - subclassDefinition.classFeatures: 서브클래스의 전체 피쳐 목록 (이게 없으면 서브클래스 피쳐가 누락됨)
    const rawFeats: any[] = [];

    if (Array.isArray(c?.classFeatures)) rawFeats.push(...c.classFeatures);
    if (Array.isArray(c?.definition?.classFeatures)) rawFeats.push(...c.definition.classFeatures);
    if (Array.isArray(c?.subclassDefinition?.classFeatures)) rawFeats.push(...c.subclassDefinition.classFeatures);

    for (const f of rawFeats) {
      // definition이 있으면 꺼내 쓰고, 없으면 객체 자체를 씀
      const def = f?.definition ?? f;
      
      // ✅ [필수] 레벨 체크!
      // requiredLevel이 존재하고, 현재 클래스 레벨보다 높으면 건너뜀
      const reqLvl = Number(def?.requiredLevel);
      if (reqLvl && reqLvl > level) continue;

      const fn = pickName(f);
      if (fn) out.classFeatures.push(fn);
    }
  }

  // Feats
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
  
  // 중복 제거 및 정렬
  out.classFeatures = uniq(out.classFeatures).sort((a, b) => a.localeCompare(b));

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
  pushSection("피트", lists.feats); 
  pushSection("전투 기교", lists.maneuvers);
  pushSection("클래스 피쳐", lists.classFeatures);

  return lines.join("\n").trim();
}