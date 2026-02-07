// src/lib/ddbNormalize.ts

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = typeof ABILITIES[number];

export const ABILITY_LABEL_KO: Record<AbilityKey, string> = {
  str: "근력",
  dex: "민첩",
  con: "건강",
  int: "지능",
  wis: "지혜",
  cha: "매력",
};

export const SKILL_LABEL_KO: Record<string, string> = {
  athletics: "운동",
  acrobatics: "곡예",
  sleightofhand: "손재주",
  stealth: "은신",
  arcana: "마법학",
  history: "역사",
  investigation: "조사",
  nature: "자연",
  religion: "종교",
  animalhandling: "동물 조련",
  insight: "통찰",
  medicine: "의학",
  perception: "지각",
  survival: "생존",
  deception: "기만",
  intimidation: "위협",
  performance: "공연",
  persuasion: "설득",
};

export const SKILL_ABILITY: Record<string, AbilityKey> = {
  athletics: "str",
  acrobatics: "dex",
  sleightofhand: "dex",
  stealth: "dex",
  arcana: "int",
  history: "int",
  investigation: "int",
  nature: "int",
  religion: "int",
  animalhandling: "wis",
  insight: "wis",
  medicine: "wis",
  perception: "wis",
  survival: "wis",
  deception: "cha",
  intimidation: "cha",
  performance: "cha",
  persuasion: "cha",
};

function mod(score: number) {
  return Math.floor((score - 10) / 2);
}


function getAllModifiers(ddb: any): any[] {
  const m = ddb?.modifiers;

  // 이미 배열인 경우 (드문 케이스)
  if (Array.isArray(m)) return m;

  // DDB 기본 구조: 카테고리별 객체
  if (m && typeof m === "object") {
    const out: any[] = [];
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) out.push(...v);
    }
    return out;
  }

  return [];
}


function getFinalAbilityScore(ddb: any, i: number, key: AbilityKey) {
  const baseVal = Number(ddb?.stats?.[i]?.value ?? ddb?.stats?.[i] ?? 0);

  const overrideVal =
    ddb?.overrideStats?.[i]?.value != null
      ? Number(ddb.overrideStats[i].value)
      : null;

  const bonusVal =
    ddb?.bonusStats?.[i]?.value != null ? Number(ddb.bonusStats[i].value) : 0;

  const modBonus = sumAbilityScoreBonusesFromModifiers(ddb, key);

  // 1) 기본/보너스/합산 결과
  let score = overrideVal != null ? overrideVal : baseVal + bonusVal + modBonus;

  // 2) "설정(Set)" 계열(예: Belt of Giant Strength) 반영:
  //    현재 점수보다 높게 설정하는 경우가 대부분이므로 max로 처리.
  const setVal = getAbilityScoreSetFromModifiers(ddb, key);
  if (setVal != null && Number.isFinite(setVal)) {
    score = Math.max(score, setVal);
  }

  return score;
}


function sumAbilityScoreBonusesFromModifiers(ddb: any, key: AbilityKey) {
  const mods = getAllModifiers(ddb);
  const full = FULLNAME[key];

  let sum = 0;

  for (const m of mods) {
    const stRaw = String(m?.subType ?? "");
    const fnRaw = String(m?.friendlySubtypeName ?? "");
    const typeRaw = String(m?.type ?? "");

    const st = stRaw.toLowerCase().replace(/\s+/g, "");
    const fn = fnRaw.toLowerCase();
    const type = typeRaw.toLowerCase();

    const hit =
      st === `${full}-score` ||
      st === `${full}-ability-score` ||
      (st.includes(full) && st.includes("score")) ||
      (fn.includes(full) && fn.includes("score")) ||
      (type.includes("bonus") &&
        (st.includes(full) || fn.includes(full)) &&
        (st.includes("score") || fn.includes("score")));

    if (!hit) continue;

    const v = Number(m?.value ?? 0);
    if (Number.isFinite(v)) sum += v;
  }

  return sum;
}


function getAbilityScoreSetFromModifiers(ddb: any, key: AbilityKey): number | null {
  const mods = getAllModifiers(ddb);
  const full = FULLNAME[key];

  let best: number | null = null;

  for (const m of mods) {
    const stRaw = String(m?.subType ?? "");
    const fnRaw = String(m?.friendlySubtypeName ?? "");
    const typeRaw = String(m?.type ?? "");

    const st = stRaw.toLowerCase().replace(/\s+/g, "");
    const fn = fnRaw.toLowerCase();
    const type = typeRaw.toLowerCase().replace(/\s+/g, "");

    // DDB에서 "설정(Set)" 계열은 보통 type이 set/override/replace류이거나
    // subType/friendlySubtypeName에 set/override/minimum 같은 단서가 같이 붙는 경우가 많음.
    const looksLikeAbilityScore =
      st === `${full}-score` ||
      st === `${full}-ability-score` ||
      (st.includes(full) && st.includes("score")) ||
      (fn.includes(full) && fn.includes("score"));

    if (!looksLikeAbilityScore) continue;

    const looksLikeSet =
      type.includes("set") ||
      type.includes("override") ||
      type.includes("replace") ||
      st.includes("set") ||
      fn.includes("set") ||
      st.includes("minimum") ||
      fn.includes("minimum");

    if (!looksLikeSet) continue;

    const v = Number(m?.value ?? NaN);
    if (!Number.isFinite(v)) continue;

    best = best == null ? v : Math.max(best, v);
  }

  return best;
}



function getSpellBonusesFromModifiers(ddb: any): { spellAttackBonusBonus: number; spellSaveDcBonus: number } {
  const mods = getAllModifiers(ddb);
  let atk = 0;
  let dc = 0;

  for (const m of mods) {
    const st = String(m?.subType ?? m?.subtype ?? "").toLowerCase().replace(/\s+/g, "");
    const fn = String(m?.friendlySubtypeName ?? "").toLowerCase();
    const type = String(m?.type ?? "").toLowerCase();

    // 대부분 'bonus' 타입에서 나오지만, 안전하게 spell 단서 우선
    const val = Number(m?.value ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;

    const isSpellish = st.includes("spell") || fn.includes("spell");
    if (!isSpellish) continue;

    const isAttack =
      st.includes("spell-attack") ||
      st.includes("spellattack") ||
      st.includes("spellattacks") ||
      fn.includes("spell attack") ||
      fn.includes("spell attacks");

    const isDc =
      st.includes("spell-save-dc") ||
      st.includes("spellsavedc") ||
      st.includes("spell-save") ||
      fn.includes("save dc") ||
      fn.includes("spell save");

    // Rod of the Pact Keeper는 보통 둘 다 +1 이므로 둘 다 누적되게
    if (isAttack) atk += val;
    if (isDc) dc += val;

    // 만약 subtype이 애매하게 'spell'만 있고 type이 'bonus'인데, friendly에 'attack'/'dc'가 없는 케이스는 무시(오탐 방지)
  }

  return { spellAttackBonusBonus: atk, spellSaveDcBonus: dc };
}

function pbFromLevel(level: number) {
  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

export type NormalizedBasic = {
  name: string;
  level: number;
  proficiencyBonus: number;
  // 주문 명중/내성 DC에 추가되는 보너스(예: Rod of the Pact Keeper)
  spellAttackBonusBonus?: number;
  spellSaveDcBonus?: number;

  hpMax: number;
  hpCurrent: number;
  ac: number;
  speedFt: number;
  initiative: number;

  abilityScores: Record<AbilityKey, number>;
  abilityMods: Record<AbilityKey, number>;

  saveMods: Record<AbilityKey, number>;
  skillMods: Record<string, number>;
};

function totalLevel(ddb: any) {
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  return classes.reduce((sum: number, c: any) => sum + Number(c?.level ?? 0), 0);
}

// ddbNormalize.ts 안에 추가/교체


// ✅ 이미 파일에 있는 것들 재사용:
// - ABILITIES (export const ABILITIES = [...] as const)
// - AbilityKey 타입(이미 있으면 재사용)
// - mod() 함수(이미 있으면 재사용)

const FULLNAME: Record<AbilityKey, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};


// ✅ 기존 getAbilityScores(ddb)를 이걸로 "통째로 교체"
function getAbilityScores(ddb: any): Record<AbilityKey, number> {
  const out: any = {};
  for (let i = 0; i < 6; i++) {
    const key = ABILITIES[i] as AbilityKey;
    out[key] = getFinalAbilityScore(ddb, i, key);
  }
  return out as Record<AbilityKey, number>;
}


function getHp(ddb: any) {
  const max =
    Number(ddb?.overrideHitPoints ?? 0) ||
    Number(ddb?.baseHitPoints ?? 0) + Number(ddb?.bonusHitPoints ?? 0) ||
    1;

  const cur =
    Number(ddb?.currentHitPoints ?? 0) ||
    Number(ddb?.hitPoints ?? 0) ||
    max;

  return { max, cur };
}

function getAc(ddb: any) {
  // 1) 직통 후보
  const direct = [
    ddb?.armorClass,
    ddb?.ac,
    ddb?.overrideArmorClass,
  ]
    .map((x: any) => Number(x))
    .find((n: number) => Number.isFinite(n) && n > 0);

  if (direct) return direct;

  // 2) characterValues / values 쪽에서 "armor-class" 같은 걸 찾기
  const cvs = Array.isArray(ddb?.characterValues) ? ddb.characterValues : [];
  for (const cv of cvs) {
    const t = String(cv?.type ?? cv?.valueType ?? cv?.definition?.type ?? "").toLowerCase();
    const n = Number(cv?.value ?? cv?.calculatedValue ?? cv?.valueInt ?? cv?.valueNumber ?? 0);
    if ((t.includes("armor") && t.includes("class")) && Number.isFinite(n) && n > 0) return n;
    if ((t === "armor-class" || t === "armorclass" || t === "ac") && Number.isFinite(n) && n > 0) return n;
  }

  // 3) 조건부: defense 관련 modifier를 합산해서 기본 10에 더하기
  // (정확도는 완벽하진 않지만, 10보다 훨씬 현실적)
  const mods = getAllModifiers(ddb);
  const acBonuses = mods
    .filter((m: any) => {
      const sub = String(m?.subType ?? m?.subtype ?? "").toLowerCase();
      const t = String(m?.type ?? "").toLowerCase();
      return sub.includes("armor-class") || sub === "ac" || (t.includes("bonus") && sub.includes("armor"));
    })
    .reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0);

  const base = 10 + (Number.isFinite(acBonuses) ? acBonuses : 0);

  // 너무 말도 안 되는 값이면 기본 10
  return base > 0 ? base : 10;
}



function getSpeedFt(ddb: any) {
  const s1 = Number(ddb?.race?.weightSpeeds?.walk ?? 0);
  const s2 = Number(ddb?.customSpeeds?.walk ?? 0);
  const s3 = Number(ddb?.customSpeeds?.walkSpeed ?? 0);
  const s4 = Number(ddb?.speed ?? 0);
  return s1 || s2 || s3 || s4 || 30;
}

export function normalizeBasic(ddb: any): NormalizedBasic {
  const name = String(ddb?.name ?? "").trim() || "Unnamed";
  const level = totalLevel(ddb) || 1;

  // PB: modifiers에 있으면 쓰고, 없으면 레벨 계산
  const mods = getAllModifiers(ddb);
  const pbFromMods =
    mods
      .filter((m: any) => m?.type === "proficiency-bonus")
      .reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0) || 0;

  const proficiencyBonus = pbFromMods || pbFromLevel(level);

  const abilityScores = getAbilityScores(ddb);
  const abilityMods: Record<AbilityKey, number> = {
    str: mod(abilityScores.str),
    dex: mod(abilityScores.dex),
    con: mod(abilityScores.con),
    int: mod(abilityScores.int),
    wis: mod(abilityScores.wis),
    cha: mod(abilityScores.cha),
  };

  const { max: hpMax, cur: hpCurrent } = getHp(ddb);
  const ac = getAc(ddb);
  const speedFt = getSpeedFt(ddb);
  const initiative = abilityMods.dex;

  const saveMods: Record<AbilityKey, number> = { ...abilityMods };

  const skillMods: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
    skillMods[skill] = abilityMods[ab];
  }

  return {
    name,
    level,
    proficiencyBonus,
    hpMax,
    hpCurrent,
    ac,
    speedFt,
    initiative,
    abilityScores,
    abilityMods,
    saveMods,
    skillMods,
  };
}
