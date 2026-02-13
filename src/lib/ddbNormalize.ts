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

/**
 * 능력치 계산 핵심 함수 (수정됨)
 * 불필요한 modifiers 반복문을 제거하고 D&D Beyond가 제공하는 계산된 필드를 우선합니다.
 */
function getFinalAbilityScore(ddb: any, i: number) {
  // 1. Override 확인 (예: 오우거 힘의 장갑 등 고정 수치 아이템)
  const overrideVal = ddb?.overrideStats?.[i]?.value;
  if (overrideVal != null) {
      return Number(overrideVal);
  }

  // 2. Base(주사위/포인트) + Bonus(종족/ASI/피트)
  // D&D Beyond는 bonusStats에 이미 종족/피트 보너스를 합산해서 줍니다.
  const baseVal = Number(ddb?.stats?.[i]?.value ?? ddb?.stats?.[i] ?? 10);
  const bonusVal = Number(ddb?.bonusStats?.[i]?.value ?? 0);

  return baseVal + bonusVal;
}

function getAbilityScores(ddb: any): Record<AbilityKey, number> {
  const out: any = {};
  // 순서: STR(0), DEX(1), CON(2), INT(3), WIS(4), CHA(5)
  for (let i = 0; i < 6; i++) {
    const key = ABILITIES[i] as AbilityKey;
    out[key] = getFinalAbilityScore(ddb, i);
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
    
    // 유효한 Modifier인지 체크 (타입이 bonus여야 함)
    // 일부 데이터에서 type이 undefined인 경우는 무시
    if (m.type && m.type !== "bonus") continue;

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
  // 1. 직접 입력된 AC가 있으면 최우선 (Custom AC)
  const override = Number(ddb?.overrideArmorClass);
  if (Number.isFinite(override) && override > 0) return override;

  // 2. 장비 기반 AC 계산
  const calculated = calculateArmorClass(ddb, dexMod);

  // 3. 기타 보너스 (Modifiers)
  // [수정] 방어구/방패 AC는 calculateArmorClass에서 이미 처리했으므로,
  // 여기서는 Ring of Protection 같은 "순수 보너스"만 더해야 합니다.
  const mods = getAllModifiers(ddb);
  let bonusAc = 0;

  for (const m of mods) {
    // Unarmored Defense 등은 calculateArmorClass 내에서 로직 처리가 복잡하므로
    // 단순 보너스 아이템(Ring of Protection 등)만 챙깁니다.
    // type: "bonus", subType: "armor-class" 인 것만
    
    if (m.type !== "bonus") continue;
    
    const sub = String(m?.subType ?? "").toLowerCase();
    // const t = String(m?.type ?? "").toLowerCase();

    if (sub === "armor-class" || sub === "ac") {
        bonusAc += Number(m?.value ?? 0);
    }
  }

  return calculated + bonusAc;
}

function getSpeedFt(ddb: any) {
  const s1 = Number(ddb?.race?.weightSpeeds?.walk ?? 0);
  const s2 = Number(ddb?.customSpeeds?.walk ?? 0);
  const s3 = Number(ddb?.customSpeeds?.walkSpeed ?? 0);
  const s4 = Number(ddb?.speed ?? 0);
  return s1 || s2 || s3 || s4 || 30;
}

function hasJackOfAllTrades(ddb: any): boolean {
  const classes = Array.isArray(ddb?.classes) ? ddb.classes : [];
  for (const c of classes) {
    if (c?.definition?.name === "Bard" && c.level >= 2) return true;
  }
  return false;
}

function getFinalSkillMod(ddb: any, skillKey: string, abilityMod: number, pb: number): number {
  const mods = getAllModifiers(ddb);
  const isJack = hasJackOfAllTrades(ddb);
  let multiplier = 0; 
  let bonus = 0;

  for (const m of mods) {
    const sub = (m?.subType ?? "").toLowerCase().replace(/\s+/g, "");
    if (sub !== skillKey) continue;
    if (m.type === "proficiency") multiplier = Math.max(multiplier, 1);
    else if (m.type === "expertise") multiplier = Math.max(multiplier, 2);
    else if (m.type === "bonus") bonus += Number(m.value || 0);
  }

  if (multiplier === 0 && isJack) {
    multiplier = 0.5;
  }

  return abilityMod + Math.floor(pb * multiplier) + bonus;
}

function getFinalSaveMod(ddb: any, abilityKey: string, abilityMod: number, pb: number): number {
  const mods = getAllModifiers(ddb);
  let isProficient = false;
  let bonus = 0;
  const target1 = `${abilityKey}-saving-throws`;
  const target2 = abilityKey;
  for (const m of mods) {
    const sub = (m?.subType ?? "").toLowerCase();
    
    // 내성 굴림 관련 수정치 찾기
    if (sub === target1 || (m.type === "proficiency" && sub === target2)) {
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

  // ✅ [수정] 능력치 계산 로직 간소화 (중복 합산 방지)
  const abilityScores = getAbilityScores(ddb);
  
  const abilityMods: Record<AbilityKey, number> = {
    str: mod(abilityScores.str), dex: mod(abilityScores.dex), con: mod(abilityScores.con),
    int: mod(abilityScores.int), wis: mod(abilityScores.wis), cha: mod(abilityScores.cha),
  };

  const { max: hpMax, cur: hpCurrent } = getHp(ddb, level, abilityMods.con);
  const ac = getAc(ddb, abilityMods.dex);
  const speedFt = getSpeedFt(ddb);
  const initiative = abilityMods.dex; // (Note: Alert feat 등 이니셔티브 보너스는 추가 구현 필요할 수 있음)

  const saveMods: Record<AbilityKey, number> = {} as any;
  for (const key of ABILITIES) {
    saveMods[key] = getFinalSaveMod(ddb, key, abilityMods[key], proficiencyBonus);
  }

  const skillMods: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
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
    saveMods,
    skillMods,
  };
}