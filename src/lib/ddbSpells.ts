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
  
  // 1. 모든 주문 소스 긁어오기 (구조가 다를 수 있으므로 안전하게 병합)
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells ?? [];
  const rawClasses = ddb?.classes ?? ddb?.character?.classes ?? [];
  
  // 혹시 모를 플랫 리스트 (일부 데이터 포맷 대응)
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

    // 🔥 [핵심 수정] 권역 주문(Bless 등) 누락 방지를 위한 필터 대폭 완화
    const validSpells = spells.filter(s => {
      const def = s.definition;
      if (!def) return false;
      const lvl = def.level ?? 0;

      // 1. 소마법은 무조건 통과
      if (lvl === 0) return true;
      
      // 2. 기본 준비 상태 확인
      if (s.prepared || s.alwaysPrepared || s.countsAsKnownSpell) return true;
      if (def.alwaysPrepared) return true;
      
      // 3. 특수 상태 (활성화, 부여됨, 제한적 사용)
      if (s.active || s.granted || s.limitedUse) return true;

      // 4. [신규] 준비 모드(preparationMode) 확인
      // 0: Prepared (준비 필요), 4: Domain(항상 준비) 등
      // 모드가 0이 아니라면 뭔가 특수한(자동 준비된) 주문일 가능성이 높음
      if (s.preparationMode && s.preparationMode !== 0) return true;

      // 5. [신규] 아는 주문(isKnown) 플래그 확인 (바드/소서러 및 일부 클레릭 데이터)
      if (s.isKnown) return true;

      // 6. [비상] "Domain" 태그가 있거나 소스 출처가 서브클래스인 경우 (Flags 체크 없이 통과)
      // (Bless 등이 prepared=false, alwaysPrepared=false로 오는 버그 대응)
      // 데이터상 구분이 어려우므로, 만약 클래스 리스트에 '강제로' 끼워져 있다면 일단 표시
      // 단, 전체 리스트를 다 가져오는 참사를 막기 위해 'overrideName'이 있거나 커스텀이면 통과
      if (s.overrideName || s.isCustom) return true;

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
        
        // 이름 우선순위: 오버라이드(유저 지정 이름) > 원본 이름
        const name = s.overrideName || def.name || "Unknown";

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
                // 중복 방지를 위해 Set에 넣을 준비
                dmgList.push(`${name}: ${parts.join(" + ")}`);
            }
        }
    }

    // 출력 헬퍼
    const printGroup = (list: string[], label?: string) => {
        if (list.length === 0) return;
        // 중복 제거 및 정렬
        const uniq = [...new Set(list)].sort((a, b) => a.localeCompare(b));
        if (label) lines.push(`[${label}]`);
        lines.push(...uniq);
        lines.push("");
    };

    // 통합 리스트 (알파벳순 전체 목록)
    const allNames = [...groups.attack, ...groups.save, ...groups.other];
    // 이름만 먼저 쫙 뽑아줍니다 (사용자 요청 스타일)
    const sortedAll = [...new Set(allNames)].sort((a, b) => a.localeCompare(b));
    lines.push(...sortedAll);
    lines.push("");

    // 카테고리별 상세
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
      processList(otherSources, "특수/종족/아이템", "wis", true); // 기본 기반 wis (임시)
  }

  return lines.length > 0 ? lines.join("\n").trim() : "주문 없음";
}