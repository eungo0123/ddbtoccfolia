// src/lib/ddbFeatures.ts

/**
 * D&D Beyond 캐릭터 raw에서 "피쳐(배경/클래스/피트 등)" 이름 목록만 뽑아낸다.
 */

function pickName(x: any): string {
  const n = x?.definition?.name ?? x?.name ?? x?.label ?? "";
  return String(n ?? "").trim();
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.map((s) => s.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

// 잡음 제거용 목록
const MANEUVER_BAN_LIST = new Set([
  "Combat Superiority",
  "Maneuvers",
  "Superiority Dice",
  "Combat Superiority (Fighter)",
  "Student of War",
  "Know Your Enemy"
]);

/**
 * ✅ 전술기동(Maneuvers) 추출 핵심 로직
 * - 재귀 탐색 대신 ddb.options.class를 직접 뒤집니다.
 * - 배틀마스터 전술기동은 설명(description)에 'superiority die'라는 문구가 무조건 들어갑니다.
 */
function extractManeuversFromOptions(ddb: any): string[] {
  const out: string[] = [];
  
  // DDB에서 클래스/종족/피트 선택지(옵션)는 이곳에 모여 있습니다.
  const classOptions = ddb?.options?.class; // 배틀마스터 기동은 여기 있음
  // const raceOptions = ddb?.options?.race;
  // const featOptions = ddb?.options?.feat;

  if (!Array.isArray(classOptions)) return [];

  for (const opt of classOptions) {
    const def = opt.definition;
    if (!def) continue;

    const name = String(def.name ?? "").trim();
    if (!name) continue;

    // 1) 이미 상위 피쳐로 분류된 것들 제외
    if (MANEUVER_BAN_LIST.has(name)) continue;

    // 2) 텍스트 분석
    // 전술기동은 보통 snippet이나 description에 "superiority die" (전투 우월 주사위) 언급이 있음
    const desc = String(def.description ?? "").toLowerCase();
    const snippet = String(def.snippet ?? "").toLowerCase();
    
    // "Maneuvers:" 접두어가 붙어있는 경우 (가장 확실)
    if (name.toLowerCase().startsWith("maneuvers:")) {
      out.push(name.replace(/^Maneuvers:\s*/i, ""));
      continue;
    }

    // 설명에 'superiority die'가 있으면 전술기동일 확률 99%
    if (desc.includes("superiority die") || snippet.includes("superiority die")) {
      out.push(name);
      continue;
    }
    
    // 혹시 모르니 displayOrder 등 다른 단서가 있을 수 있지만, 위 조건으로 대부분 커버됨
  }

  return out;
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

  // 1. Background
  const bg = pickName(ddb?.background);
  if (bg) out.background = bg;

  // 2. Classes & Class Features
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
      // c?.features, // 중복 데이터가 많아서 classFeatures 우선
      c?.definition?.classFeatures,
    ];
    
    for (const p of cfPools) {
      if (Array.isArray(p)) {
        for (const f of p) {
          const fn = pickName(f);
          // "Maneuvers" 같은 헤더성 피쳐는 목록에는 넣되, 전술기동 목록과는 별개로 취급
          if (fn && !MANEUVER_BAN_LIST.has(fn)) {
             out.classFeatures.push(fn);
          }
        }
      }
    }
  }

  // 3. Feats
  const featsPools = [ddb?.feats, ddb?.featChoices, ddb?.options?.feats, ddb?.characterFeats];
  for (const p of featsPools) {
    if (!p) continue;
    if (Array.isArray(p)) {
      for (const f of p) {
        const fn = pickName(f);
        if (fn) out.feats.push(fn);
      }
    } else if (typeof p === "object") {
      for (const v of Object.values(p)) {
        if (Array.isArray(v)) {
          for (const f of v as any[]) {
            const fn = pickName(f);
            if (fn) out.feats.push(fn);
          }
        }
      }
    }
  }

  // 4. Maneuvers (전술기동)
  // 기존의 복잡한 재귀 대신, options 배열을 뒤져서 찾아냄
  out.maneuvers = uniq(extractManeuversFromOptions(ddb));

  // 중복 제거 및 정렬
  out.classes = uniq(out.classes);
  out.feats = uniq(out.feats);
  
  // classFeatures에서 maneuvers에 이미 들어간 이름이 있다면 제거 (깔끔하게 보이기 위함)
  out.classFeatures = uniq(out.classFeatures).filter(f => !out.maneuvers.includes(f));

  return out;
}

export function buildFeatureListKo(lists: FeatureLists): string {
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
  
  // 전술기동을 클래스 피쳐보다 먼저 보여주거나 따로 강조
  pushSection("전투 기교 (Maneuvers)", lists.maneuvers);
  
  pushSection("클래스 피쳐", lists.classFeatures);

  return lines.join("\n").trim();
}