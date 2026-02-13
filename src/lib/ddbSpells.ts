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
  
  // 2. 추가 소스 (종족, 피트, 아이템)
  const otherSources = [
    ...(ddb?.spells?.race ?? []),
    ...(ddb?.spells?.feat ?? []),
    ...(ddb?.spells?.item ?? []),
    ...(ddb?.spells?.background ?? [])
  ];

  // 헬퍼 함수: 리스트 처리
  const processList = (spells: any[], title: string, abilityKey: string, showHeader: boolean) => {
    if (!Array.isArray(spells) || spells.length === 0) return;

    // 🔥 [수정] 필터링 조건 대폭 완화
    // 도메인 주문(Bless 등)이 누락되지 않도록 'definition.alwaysPrepared'도 확인
    const validSpells = spells.filter(s => {
      const def = s.definition;
      if (!def) return false;
      const lvl = def.level ?? 0;

      // 소마법은 무조건 통과
      if (lvl === 0) return true;
      
      // 준비됨 / 항상 준비됨 / 아는 주문
      if (s.prepared || s.alwaysPrepared || s.countsAsKnownSpell) return true;
      
      // definition(원본 정의) 상에서 항상 준비된 주문 (클레릭 도메인 주문 등)
      if (def.alwaysPrepared) return true;
      
      // 활성화됨 / 아이템 부여 / 사용 횟수 제한 있는 특수 주문
      if (s.active || s.granted || s.limitedUse) return true;

      // 그래도 없으면 false
      return false;
    });

    if (validSpells.length === 0) return;

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

    for (const s of validSpells) {
        const def = s.definition;
        const name = s.overrideName || def.name || "Unknown"; // 이름 변경 적용

        // 그룹 분류
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

    // 출력
    const printGroup = (list: string[], label?: string) => {
        if (list.length === 0) return;
        list.sort();
        if (label) lines.push(`[${label}]`);
        lines.push(...list);
        lines.push("");
    };

    // 통합해서 출력할지 분리할지 결정 (여기선 섞어서 출력 후 아래에 카테고리)
    const allNames = [...groups.attack, ...groups.save, ...groups.other].sort();
    lines.push(...allNames);
    lines.push("");

    printGroup(groups.attack, "명중 주문");
    printGroup(groups.save, "내성굴림 주문");
    printGroup(groups.other, "기타/치유/버프");

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