// src/lib/ddbSpells.ts
import { NormalizedBasic } from "./ddbNormalize";

const ABILITY_ID_TO_KEY: Record<number, string> = {
  1: "str", 2: "dex", 3: "con", 4: "int", 5: "wis", 6: "cha",
};

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
    
    // 헤더 정보
    const abilityKey = getSpellAbility(classDef);
    const abilityMod = basic.abilityMods[abilityKey as keyof typeof basic.abilityMods] ?? 0;
    const itemDc = basic.spellSaveDcBonus ?? 0;
    const itemAtk = basic.spellAttackBonusBonus ?? 0;
    
    const saveDc = 8 + basic.proficiencyBonus + abilityMod + itemDc;
    const attackBonus = basic.proficiencyBonus + abilityMod + itemAtk;

    // 1. 클래스 헤더
    lines.push(`### ${className} [기반: ${abilityKey.toUpperCase()}]`);
    lines.push(`(DC ${saveDc} / 명중 +${attackBonus})`);
    lines.push("");

    const spells = classSpellGroup?.spells;
    if (!Array.isArray(spells)) continue;

    // 분류용 바구니
    const allSpells: string[] = [];
    const attackSpells: string[] = [];
    const saveSpells: string[] = [];
    const otherSpells: string[] = [];
    
    // ✅ [추가] 데미지 정보 모으는 바구니
    const damageInfoList: string[] = [];

    for (const s of spells) {
      const def = s?.definition;
      const lvl = def?.level ?? 0;
      
      const isPrep = s?.prepared || s?.alwaysPrepared || s?.countsAsKnownSpell || lvl === 0;
      if (!isPrep) continue;

      const name = def?.name ?? "Unknown";

      // 1. 전체 목록 추가
      allSpells.push(name);

      // 2. 카테고리 분류
      if (def?.requiresAttackRoll) {
        attackSpells.push(name);
      } else if (def?.requiresSavingThrow) {
        saveSpells.push(name);
      } else {
        otherSpells.push(name);
      }

      // ✅ [추가] 데미지 추출 로직
      const mods = def?.modifiers;
      if (Array.isArray(mods)) {
        // modifiers 중에서 type이 "damage"인 것을 찾음
        const dmgMods = mods.filter((m: any) => m.type === "damage");
        
        if (dmgMods.length > 0) {
          // 데미지가 여러 속성일 수 있으므로(예: Ice Storm), 합쳐서 표현
          const parts = dmgMods.map((m: any) => {
            // 주사위값(diceString)이 없으면 고정값(fixedValue) 확인
            const dice = m.die?.diceString ?? m.die?.fixedValue ?? "?";
            const type = m.subType ?? "damage";
            return `${dice} ${type}`;
          });
          
          // "Fireball: 8d6 fire" 형태로 저장
          damageInfoList.push(`${name}:${parts.join(" + ")}`);
        }
      }
    }

    // 정렬 함수
    const sortFn = (a: string, b: string) => a.localeCompare(b);
    allSpells.sort(sortFn);
    attackSpells.sort(sortFn);
    saveSpells.sort(sortFn);
    otherSpells.sort(sortFn);
    damageInfoList.sort(sortFn); // 데미지 목록도 이름순 정렬

    if (allSpells.length === 0) {
      lines.push("(준비된 주문 없음)");
      lines.push("");
    } else {
      // 전체 목록
      lines.push(...allSpells);
      lines.push("");

      // 카테고리별 목록
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

      // ✅ [추가] 맨 아래에 피해량 표기
      if (damageInfoList.length > 0) {
        lines.push("----------------");
        lines.push("[주문 피해량 참고]");
        lines.push(...damageInfoList);
        lines.push("");
      }
    }

    lines.push("--------------------------------"); // 클래스 간 구분선
    lines.push("");
  }

  return lines.join("\n").trim();
}