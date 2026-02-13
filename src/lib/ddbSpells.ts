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
  
  // 1. 모든 주문 소스 긁어오기
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells ?? [];
  const rawClasses = ddb?.classes ?? ddb?.character?.classes ?? [];
  const flatClassSpells = ddb?.spells?.class ?? ddb?.character?.spells?.class ?? [];

  // 2. 추가 소스 (종족, 피트, 아이템)
  const otherSources = [
    ...(ddb?.spells?.race ?? []),
    ...(ddb?.spells?.feat ?? []),
    ...(ddb?.spells?.item ?? []),
    ...(ddb?.spells?.background ?? []),
    ...flatClassSpells 
  ];

  // 헬퍼 함수: 리스트 처리
  const processList = (spells: any[], title: string, abilityKey: string, showHeader: boolean) => {
    if (!Array.isArray(spells) || spells.length === 0) return;

    // 분류용 바구니
    const validSpells: any[] = [];
    const unpreparedNames: string[] = []; // 준비되지 않았지만 레벨이 있는 주문들

    for (const s of spells) {
      const def = s.definition;
      if (!def) continue;
      const lvl = def.level ?? 0;
      const name = s.overrideName || def.name || "Unknown";

      // 1. 소마법은 무조건 통과 (준비 개념 없음)
      if (lvl === 0) {
        validSpells.push(s);
        continue;
      }
      
      // 2. 준비된 주문인지 확인
      const isPrepared = 
        s.prepared || 
        s.alwaysPrepared || 
        s.countsAsKnownSpell || 
        def.alwaysPrepared || 
        s.active || 
        s.granted || 
        s.limitedUse || 
        (s.preparationMode && s.preparationMode !== 0) ||
        s.isKnown || 
        s.overrideName || 
        s.isCustom;

      if (isPrepared) {
        validSpells.push(s);
      } else {
        // 3. 준비되지 않음 -> 미준비 목록에 이름만 저장 (중복 방지)
        // (클레릭의 경우 전체 주문 목록이 여기에 해당될 수 있음)
        if (!unpreparedNames.includes(name)) {
          unpreparedNames.push(name);
        }
      }
    }

    if (validSpells.length === 0 && unpreparedNames.length === 0) return;

    // 헤더 출력
    if (showHeader) {
        const abilityMod = basic.abilityMods[abilityKey as keyof typeof basic.abilityMods] ?? 0;
        const saveDc = 8 + basic.proficiencyBonus + abilityMod + (basic.spellSaveDcBonus ?? 0);
        const attackBonus = basic.proficiencyBonus + abilityMod + (basic.spellAttackBonusBonus ?? 0);
        
        lines.push(`### ${title} [기반: ${abilityKey.toUpperCase()}]`);
        lines.push(`(DC ${saveDc} / 명중 +${attackBonus})`);
        lines.push("");
    }

    const groups: Record<string, string[]> = {
        attack: [], save: [], other: []
    };
    const dmgList: string[] = [];

    // 유효한(준비된) 주문 처리
    for (const s of validSpells) {
        const def = s.definition;
        const name = s.overrideName || def.name || "Unknown";

        if (def.requiresAttackRoll) groups.attack.push(name);
        else if (def.requiresSavingThrow) groups.save.push(name);
        else groups.other.push(name);

        // 데미지 파싱
        if (Array.isArray(def.modifiers)) {
            const dmgMods = def.modifiers.filter((m: any) => m.type === "damage");
            if (dmgMods.length > 0) {
                const parts = dmgMods.map((m: any) => {
                    const d = m.die?.diceString ?? m.die?.fixedValue ?? "?";
                    const t = m.subType ?? "damage";
                    return `${d} ${t}`;
                });
                dmgList.push(`${name}: ${parts.join(" + ")}`);
            }
        }
    }

    // 출력 헬퍼
    const printGroup = (list: string[], label?: string) => {
        if (list.length === 0) return;
        const uniq = [...new Set(list)].sort((a, b) => a.localeCompare(b));
        if (label) lines.push(`[${label}]`);
        lines.push(...uniq);
        lines.push("");
    };

    // 1. 준비된 주문 목록 출력
    const allNames = [...groups.attack, ...groups.save, ...groups.other];
    if (allNames.length > 0) {
        const sortedAll = [...new Set(allNames)].sort((a, b) => a.localeCompare(b));
        lines.push(...sortedAll);
        lines.push("");
        
        printGroup(groups.attack, "명중 주문");
        printGroup(groups.save, "내성굴림 주문");
        printGroup(groups.other, "기타/치유/버프");
    }

    // 2. 미준비 주문 목록 출력 (폴백)
    // 권역 주문이 준비 안 된 것으로 인식될 경우 여기서라도 보이게 함
    if (unpreparedNames.length > 0) {
        lines.push("----------------");
        lines.push("[미준비/기타 주문 목록]");
        lines.push("(D&D Beyond에서 준비되지 않은 것으로 표시된 주문들)");
        
        // 너무 많으면 보기 힘들 수 있으므로 쉼표로 구분하여 출력
        unpreparedNames.sort((a, b) => a.localeCompare(b));
        lines.push(unpreparedNames.join(", "));
        lines.push("");
    }

    if (dmgList.length > 0) {
        lines.push("----------------");
        lines.push("[주문 피해량 참고]");
        lines.push(...[...new Set(dmgList)].sort());
        lines.push("");
    }
    
    lines.push("--------------------------------");
    lines.push("");
  };

  // 3. 클래스 주문 처리
  for (const group of rawClassSpells) {
      const classDef = rawClasses.find((c: any) => c.id === group.characterClassId);
      const name = classDef?.definition?.name ?? "Unknown Class";
      const ab = getSpellAbility(classDef);
      processList(group.spells, name, ab, true);
  }

  // 4. 기타 주문 처리
  if (otherSources.length > 0) {
      processList(otherSources, "특수/종족/아이템", "wis", true);
  }

  return lines.length > 0 ? lines.join("\n").trim() : "주문 없음";
}