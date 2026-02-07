// src/lib/ddbNormalize.ts
import { calculateArmorClass } from "./ddbAc";

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

export type NormalizedAttack = {
  name: string;
  attackBonus: number;
  damage: string;
  damageType: string;
  notes: string;
};

export type NormalizedBasic = {
  name: string;
  level: number;
  proficiencyBonus: number;
  
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

function mod(score: number) {
  return Math.floor((score - 10) / 2);
}

function getAllModifiers(ddb: any): any[] {
  const m = ddb?.modifiers;
  if (Array.isArray(m)) return m;
  if (m && typeof m === "object") {
    const out: any[] = [];
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) out.push(...v);
    }
    return out;
  }
  return [];
}

const FULLNAME: Record<AbilityKey, string> = {
  str: "strength",
  dex: "dexterity",
  con: "constitution",
  int: "intelligence",
  wis: "wisdom",
  cha: "charisma",
};

function sumAbilityScoreBonusesFromModifiers(ddb: any, key: AbilityKey) {
  const mods = getAllModifiers(ddb);
  const full = FULLNAME[key];
  let sum = 0;

  for (const m of mods) {
    const stRaw = String(m?.subType ?? "").toLowerCase().replace(/\s+/g, "");
    const fnRaw = String(m?.friendlySubtypeName ?? "").toLowerCase();
    const typeRaw = String(m?.type ?? "").toLowerCase();

    const hit =
      stRaw.includes(full) && stRaw.includes("score") ||
      fnRaw.includes(full) && fnRaw.includes("score") ||
      (typeRaw.includes("bonus") && (stRaw.includes(full) || fnRaw.includes(full)));

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
    const stRaw = String(m?.subType ?? "").toLowerCase();
    const typeRaw = String(m?.type ?? "").toLowerCase();
    
    if (!stRaw.includes(full)) continue;
    if (!typeRaw.includes("set") && !typeRaw.includes("override")) continue;

    const v = Number(m?.value ?? NaN);
    if (Number.isFinite(v)) {
      best = best == null ? v : Math.max(best, v);
    }
  }
  return best;
}

function getFinalAbilityScore(ddb: any, i: number, key: AbilityKey) {
  const baseVal = Number(ddb?.stats?.[i]?.value ?? ddb?.stats?.[i] ?? 0);
  const overrideVal = ddb?.overrideStats?.[i]?.value != null ? Number(ddb.overrideStats[i].value) : null;
  const bonusVal = ddb?.bonusStats?.[i]?.value != null ? Number(ddb.bonusStats[i].value) : 0;
  const modBonus = sumAbilityScoreBonusesFromModifiers(ddb, key);

  let score = overrideVal != null ? overrideVal : baseVal + bonusVal + modBonus;
  
  const setVal = getAbilityScoreSetFromModifiers(ddb, key);
  if (setVal != null && Number.isFinite(setVal)) {
    score = Math.max(score, setVal);
  }
  return score;
}

function getAbilityScores(ddb: any): Record<AbilityKey, number> {
  const out: any = {};
  for (let i = 0; i < 6; i++) {
    const key = ABILITIES[i] as AbilityKey;
    out[key] = getFinalAbilityScore(ddb, i, key);
  }
  return out as Record<AbilityKey, number>;
}

function getSpellBonusesFromModifiers(ddb: any) {
  const mods = getAllModifiers(ddb);
  let atk = 0;
  let dc = 0;

  for (const m of mods) {
    const val = Number(m?.value ?? 0);
    if (!Number.isFinite(val) || val === 0) continue;

    const st = String(m?.subType ?? "").toLowerCase().replace(/\s+/g, "");
    const fn = String(m?.friendlySubtypeName ?? "").toLowerCase();

    if (st.includes("spell-attack") || fn.includes("spell attack")) {
        atk += val;
    }
    if (st.includes("spell-save-dc") || fn.includes("save dc") || st.includes("spell-save")) {
        dc += val;
    }
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

function totalLevel(ddb: any) {
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  return classes.reduce((sum: number, c: any) => sum + Number(c?.level ?? 0), 0);
}

function getHp(ddb: any) {
  const max = Number(ddb?.overrideHitPoints ?? 0) ||
    Number(ddb?.baseHitPoints ?? 0) + Number(ddb?.bonusHitPoints ?? 0) || 1;
  const cur = Number(ddb?.currentHitPoints ?? 0) || Number(ddb?.hitPoints ?? 0) || max;
  return { max, cur };
}

// ✅ [수정] getAc가 이제 dexMod를 인자로 받습니다.
function getAc(ddb: any, dexMod: number) {
  const direct = [ddb?.armorClass, ddb?.ac, ddb?.overrideArmorClass]
    .map((x: any) => Number(x))
    .find((n: number) => Number.isFinite(n) && n > 0);

  if (direct) return direct;

  // ✅ [수정] calculateArmorClass에 dexMod 전달
  const calculated = calculateArmorClass(ddb, dexMod);

  const mods = getAllModifiers(ddb);
  const acBonuses = mods
    .filter((m: any) => {
      const sub = String(m?.subType ?? "").toLowerCase();
      const t = String(m?.type ?? "").toLowerCase();
      return sub.includes("armor-class") || sub === "ac" || (t.includes("bonus") && sub.includes("armor"));
    })
    .reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0);

  return calculated + acBonuses;
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

  const mods = getAllModifiers(ddb);
  const pbFromMods = mods
    .filter((m: any) => m?.type === "proficiency-bonus")
    .reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0) || 0;

  const proficiencyBonus = pbFromMods || pbFromLevel(level);

  // 1. 능력치 계산
  const abilityScores = getAbilityScores(ddb);
  // 2. 수정치 계산 (여기서 종족/피트 보너스 포함된 정확한 값이 나옴)
  const abilityMods: Record<AbilityKey, number> = {
    str: mod(abilityScores.str),
    dex: mod(abilityScores.dex),
    con: mod(abilityScores.con),
    int: mod(abilityScores.int),
    wis: mod(abilityScores.wis),
    cha: mod(abilityScores.cha),
  };

  const { max: hpMax, cur: hpCurrent } = getHp(ddb);
  
  // ✅ [수정] getAc를 호출할 때 정확한 민첩 수정치를 전달
  const ac = getAc(ddb, abilityMods.dex);
  
  const speedFt = getSpeedFt(ddb);
  const initiative = abilityMods.dex;

  const saveMods: Record<AbilityKey, number> = { ...abilityMods };

  const skillMods: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
    skillMods[skill] = abilityMods[ab];
  }

  const { spellAttackBonusBonus, spellSaveDcBonus } = getSpellBonusesFromModifiers(ddb);

  return {
    name,
    level,
    proficiencyBonus,
    spellAttackBonusBonus,
    spellSaveDcBonus,
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