// src/lib/ddbNormalize.ts
import { calculateArmorClass } from "./ddbAc";

// ==========================================
// 1. 상수 및 타입 정의
// ==========================================
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityKey = typeof ABILITIES[number];

export const ABILITY_LABEL_KO: Record<AbilityKey, string> = {
  str: "근력", dex: "민첩", con: "건강", int: "지능", wis: "지혜", cha: "매력",
};

export const SKILL_LABEL_KO: Record<string, string> = {
  athletics: "운동", acrobatics: "곡예", sleightofhand: "손재주", stealth: "은신",
  arcana: "마법학", history: "역사", investigation: "조사", nature: "자연", religion: "종교",
  animalhandling: "동물 조련", insight: "통찰", medicine: "의학", perception: "지각", survival: "생존",
  deception: "기만", intimidation: "위협", performance: "공연", persuasion: "설득",
};

export const SKILL_ABILITY: Record<string, AbilityKey> = {
  athletics: "str", acrobatics: "dex", sleightofhand: "dex", stealth: "dex",
  arcana: "int", history: "int", investigation: "int", nature: "int", religion: "int",
  animalhandling: "wis", insight: "wis", medicine: "wis", perception: "wis", survival: "wis",
  deception: "cha", intimidation: "cha", performance: "cha", persuasion: "cha",
};

export type ClassInfo = {
  name: string;
  subclass: string;
  level: number;
};

export type NormalizedBasic = {
  name: string;
  classesStr: string; 
  classes: ClassInfo[];
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

// ==========================================
// 2. 헬퍼 함수들
// ==========================================
function mod(score: number) { return Math.floor((score - 10) / 2); }

function getAllModifiers(ddb: any): any[] {
  const m = ddb?.modifiers;
  if (Array.isArray(m)) return m;
  if (m && typeof m === "object") {
    const out: any[] = [];
    for (const v of Object.values(m)) { if (Array.isArray(v)) out.push(...v); }
    return out;
  }
  return [];
}

const FULLNAME: Record<AbilityKey, string> = {
  str: "strength", dex: "dexterity", con: "constitution", int: "intelligence", wis: "wisdom", cha: "charisma",
};

function sumAbilityScoreBonusesFromModifiers(ddb: any, key: AbilityKey) {
  const mods = getAllModifiers(ddb);
  const full = FULLNAME[key];
  let sum = 0;
  for (const m of mods) {
    const stRaw = String(m?.subType ?? "").toLowerCase().replace(/\s+/g, "");
    const fnRaw = String(m?.friendlySubtypeName ?? "").toLowerCase();
    const typeRaw = String(m?.type ?? "").toLowerCase();
    const hit = stRaw.includes(full) && stRaw.includes("score") || fnRaw.includes(full) && fnRaw.includes("score") || (typeRaw.includes("bonus") && (stRaw.includes(full) || fnRaw.includes(full)));
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
    if (Number.isFinite(v)) { best = best == null ? v : Math.max(best, v); }
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
  if (setVal != null && Number.isFinite(setVal)) { score = Math.max(score, setVal); }
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
    if (st.includes("spell-attack") || fn.includes("spell attack")) { atk += val; }
    if (st.includes("spell-save-dc") || fn.includes("save dc") || st.includes("spell-save")) { dc += val; }
  }
  return { spellAttackBonusBonus: atk, spellSaveDcBonus: dc };
}

function getHpBonusesPerLevel(ddb: any) {
  const mods = getAllModifiers(ddb);
  let perLevel = 0;
  for (const m of mods) {
    const sub = String(m?.subType ?? "").toLowerCase();
    if (sub === "hit-points-per-level") {
      const v = Number(m?.value ?? 0);
      if (Number.isFinite(v)) perLevel += v;
    }
  }
  return perLevel;
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

function getClassesInfo(ddb: any): ClassInfo[] {
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  return classes.map((c: any) => ({
    name: c?.definition?.name ?? "Unknown",
    subclass: c?.subclassDefinition?.name ?? "",
    level: c?.level ?? 0,
  }));
}

function getHp(ddb: any, level: number, conMod: number) {
  const override = Number(ddb?.overrideHitPoints ?? 0);
  const removed = Number(ddb?.removedHitPoints ?? 0);
  const temp = Number(ddb?.temporaryHitPoints ?? 0);
  let max = 0;
  if (override > 0) {
    max = override;
  } else {
    const base = Number(ddb?.baseHitPoints ?? 0);
    const bonus = Number(ddb?.bonusHitPoints ?? 0);
    const conBonus = conMod * level;
    const perLevelBonus = getHpBonusesPerLevel(ddb) * level;
    max = base + bonus + conBonus + perLevelBonus;
  }
  const cur = max - removed + temp;
  return { max, cur: Math.max(0, cur) };
}

function getAc(ddb: any, dexMod: number) {
  const direct = [ddb?.armorClass, ddb?.ac, ddb?.overrideArmorClass].map((x: any) => Number(x)).find((n: number) => Number.isFinite(n) && n > 0);
  if (direct) return direct;
  const calculated = calculateArmorClass(ddb, dexMod);
  const mods = getAllModifiers(ddb);
  const acBonuses = mods.filter((m: any) => {
    const sub = String(m?.subType ?? "").toLowerCase();
    const t = String(m?.type ?? "").toLowerCase();
    return sub.includes("armor-class") || sub === "ac" || (t.includes("bonus") && sub.includes("armor"));
  }).reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0);
  return calculated + acBonuses;
}

function getSpeedFt(ddb: any) {
  const s1 = Number(ddb?.race?.weightSpeeds?.walk ?? 0);
  const s2 = Number(ddb?.customSpeeds?.walk ?? 0);
  const s3 = Number(ddb?.customSpeeds?.walkSpeed ?? 0);
  const s4 = Number(ddb?.speed ?? 0);
  return s1 || s2 || s3 || s4 || 30;
}

// ✅ [추가] 잭 오브 올 트레이드(Bard) 확인
function hasJackOfAllTrades(ddb: any): boolean {
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  for (const c of classes) {
    if (c?.definition?.name === "Bard" && c.level >= 2) return true;
  }
  return false;
}

// ✅ [추가] 스킬 수정치 계산 (숙련, 전문화, 잭오브올트레이드 포함)
function getFinalSkillMod(ddb: any, skillKey: string, abilityMod: number, pb: number): number {
  const mods = getAllModifiers(ddb);
  const isJack = hasJackOfAllTrades(ddb);
  
  let multiplier = 0; // 0=none, 0.5=jack, 1=prof, 2=expert
  let bonus = 0;

  for (const m of mods) {
    // subType이 "stealth", "acrobatics" 등으로 들어옴
    const sub = (m?.subType ?? "").toLowerCase().replace(/\s+/g, "");
    if (sub !== skillKey) continue;

    if (m.type === "proficiency") multiplier = Math.max(multiplier, 1);
    else if (m.type === "expertise") multiplier = Math.max(multiplier, 2);
    else if (m.type === "bonus") bonus += Number(m.value || 0);
  }

  // 잭 오브 올 트레이드: 숙련(1)도 전문화(2)도 아니면 0.5 적용
  if (multiplier === 0 && isJack) {
    multiplier = 0.5;
  }

  return abilityMod + Math.floor(pb * multiplier) + bonus;
}

// ✅ [추가] 내성 굴림 수정치 계산
function getFinalSaveMod(ddb: any, abilityKey: string, abilityMod: number, pb: number): number {
  const mods = getAllModifiers(ddb);
  let isProficient = false;
  let bonus = 0;

  // 내성 굴림은 subType이 "wisdom-saving-throws" 또는 "wisdom" 등으로 올 수 있음
  const target1 = `${abilityKey}-saving-throws`;
  const target2 = abilityKey;

  for (const m of mods) {
    const sub = (m?.subType ?? "").toLowerCase();
    if (sub === target1 || sub === target2) {
      if (m.type === "proficiency") isProficient = true;
      if (m.type === "bonus") bonus += Number(m.value || 0);
    }
  }

  return abilityMod + (isProficient ? pb : 0) + bonus;
}

// ==========================================
// 3. 메인 변환 함수
// ==========================================
export function normalizeBasic(ddb: any): NormalizedBasic {
  const name = String(ddb?.name ?? "").trim() || "Unnamed";
  const level = totalLevel(ddb) || 1;
  const classes = getClassesInfo(ddb);
  const classesStr = classes.map(c => c.subclass ? `${c.name} (${c.subclass}) ${c.level}` : `${c.name} ${c.level}`).join(" / ");

  const mods = getAllModifiers(ddb);
  const pbFromMods = mods.filter((m: any) => m?.type === "proficiency-bonus").reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0) || 0;
  const proficiencyBonus = pbFromMods || pbFromLevel(level);

  const abilityScores = getAbilityScores(ddb);
  const abilityMods: Record<AbilityKey, number> = {
    str: mod(abilityScores.str), dex: mod(abilityScores.dex), con: mod(abilityScores.con),
    int: mod(abilityScores.int), wis: mod(abilityScores.wis), cha: mod(abilityScores.cha),
  };

  const { max: hpMax, cur: hpCurrent } = getHp(ddb, level, abilityMods.con);
  const ac = getAc(ddb, abilityMods.dex);
  const speedFt = getSpeedFt(ddb);
  const initiative = abilityMods.dex; // 참고: Alert 피트 같은 건 여기서 추가 계산 필요할 수도 있음

  // ✅ [수정] 내성 굴림 정확히 계산
  const saveMods: Record<AbilityKey, number> = {} as any;
  for (const key of ABILITIES) {
    saveMods[key] = getFinalSaveMod(ddb, key, abilityMods[key], proficiencyBonus);
  }

  // ✅ [수정] 스킬 수정치 정확히 계산
  const skillMods: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
    // 스킬 키(athletics 등)와 능력치 수정치(str 등)를 넘겨서 계산
    skillMods[skill] = getFinalSkillMod(ddb, skill, abilityMods[ab], proficiencyBonus);
  }

  const { spellAttackBonusBonus, spellSaveDcBonus } = getSpellBonusesFromModifiers(ddb);

  return {
    name,
    classesStr, 
    classes,
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
    saveMods, // ✅ 수정됨
    skillMods, // ✅ 수정됨
  };
}