// src/lib/ddbSpells.ts
import { NormalizedBasic } from "./ddbNormalize";

const ABILITY_ID_TO_KEY: Record<number, string> = {
  1: "str", 2: "dex", 3: "con", 4: "int", 5: "wis", 6: "cha",
};

/**
 * 클래스별 주문 능력치(INT, WIS 등)를 찾아내는 함수
 */
function getSpellAbility(classDef: any): string {
  const id = classDef?.definition?.spellCastingAbilityId;
  if (id && ABILITY_ID_TO_KEY[id]) return ABILITY_ID_TO_KEY[id];

  const name = String(classDef?.definition?.name ?? "").toLowerCase();
  if (name.includes("wizard") || name.includes("artificer") || name.includes("rogue") || name.includes("fighter")) return "int";
  if (name.includes("cleric") || name.includes("druid") || name.includes("ranger") || name.includes("monk")) return "wis";
  if (name.includes("warlock") || name.includes("sorcerer") || name.includes("bard") || name.includes("paladin")) return "cha";

  return "int"; // 기본값
}

export function buildSpellListKo(ddb: any, basic: NormalizedBasic): string {
  const lines: string[] = [];
  
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells;
  const rawClasses = ddb?.classes ?? ddb?.character?.classes;

  if (!Array.isArray(rawClassSpells)) return "주문 목록을 찾을 수 없습니다.";

  for (const classSpellGroup of rawClassSpells) {
    const classId = classSpellGroup?.characterClassId;
    const classDef = Array.isArray(rawClasses) 
      ? rawClasses.find((c: any) => c.id === classId) 
      : null;
    
    const className = classDef?.definition?.name ?? "Unknown Class";
    
    // 헤더 정보 계산
    const abilityKey = getSpellAbility(classDef);
    const abilityMod = basic.abilityMods[abilityKey as keyof typeof basic.abilityMods] ?? 0;
    const itemDc = basic.spellSaveDcBonus ?? 0;
    const itemAtk = basic.spellAttackBonusBonus ?? 0;
    
    const saveDc = 8 + basic.proficiencyBonus + abilityMod + itemDc;
    const attackBonus = basic.proficiencyBonus + abilityMod + itemAtk;

    // 1. 클래스 헤더 출력
    lines.push(`### ${className} [기반: ${abilityKey.toUpperCase()}]`);
    lines.push(`(DC ${saveDc} / 명중 +${attackBonus})`);
    lines.push("");

    const spells = classSpellGroup?.spells;
    if (!Array.isArray(spells)) continue;

    // ✅ 목록 바구니들
    const allSpells: string[] = [];   // 전체 목록용
    const attackSpells: string[] = []; // 분류용
    const saveSpells: string[] = [];
    const otherSpells: string[] = [];

    for (const s of spells) {
      const def = s?.definition;
      const lvl = def?.level ?? 0;
      
      // 준비된 주문만 필터링
      const isPrep = s?.prepared || s?.alwaysPrepared || s?.countsAsKnownSpell || lvl === 0;
      if (!isPrep) continue;

      const name = def?.name ?? "Unknown";

      // 1. 전체 목록에 추가
      allSpells.push(name);

      // 2. 카테고리별 분류
      if (def?.requiresAttackRoll) {
        attackSpells.push(name);
      } else if (def?.requiresSavingThrow) {
        saveSpells.push(name);
      } else {
        otherSpells.push(name);
      }
    }

    // 정렬 (알파벳순)
    const sortFn = (a: string, b: string) => a.localeCompare(b);
    allSpells.sort(sortFn);
    attackSpells.sort(sortFn);
    saveSpells.sort(sortFn);
    otherSpells.sort(sortFn);

    if (allSpells.length === 0) {
      lines.push("(준비된 주문 없음)");
      lines.push("");
    } else {
      // ✅ [추가됨] 전체 목록 먼저 출력!
      lines.push(...allSpells);
      lines.push(""); // 한 줄 띄우기

      // 그 다음 카테고리별 출력
      if (attackSpells.length > 0) {
        lines.push("[명중 주문]");
        lines.push(...attackSpells);
        lines.push("");
      }

      if (saveSpells.length > 0) {
        lines.push("[내성굴림 주문]");
        lines.push(...saveSpells);
        lines.push("");
      }

      if (otherSpells.length > 0) {
        lines.push("[기타/치유/버프]");
        lines.push(...otherSpells);
        lines.push("");
      }
    }

    lines.push("--------------------------------");
    lines.push("");
  }

  return lines.join("\n").trim();
}