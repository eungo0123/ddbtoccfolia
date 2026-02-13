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

  // ====================================================
  // 1. 데이터 소스 확보 (클래스 + 종족 + 피트 + 아이템)
  // ====================================================
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells ?? [];
  const rawClasses = ddb?.classes ?? ddb?.character?.classes ?? [];
  
  // 혹시 모를 누락을 대비해 character.spells.class (플랫 구조)도 확인
  const flatClassSpells = ddb?.spells?.class ?? ddb?.character?.spells?.class ?? [];
  
  const spellsRace = ddb?.spells?.race ?? ddb?.character?.spells?.race ?? [];
  const spellsFeat = ddb?.spells?.feat ?? ddb?.character?.spells?.feat ?? [];
  const spellsItem = ddb?.spells?.item ?? ddb?.character?.spells?.item ?? [];
  const spellsBg = ddb?.spells?.background ?? ddb?.character?.spells?.background ?? [];

  // 전역 데미지 정보 수집용
  const damageInfoList: string[] = [];

  // 헬퍼: 주문 목록 처리 및 출력
  const processSpellList = (spells: any[], title: string, abilityKey: string, showHeader: boolean) => {
    if (!Array.isArray(spells) || spells.length === 0) return;

    // 🔥 [핵심 수정] 준비 여부 판정 로직 대폭 강화
    const validSpells = spells.filter(s => {
      const def = s?.definition;
      if (!def) return false;
      const lvl = def.level ?? 0;

      // 1. 소마법(0레벨)은 무조건 포함
      if (lvl === 0) return true;
      
      // 2. 명시적으로 준비됨(prepared) or 항상 준비됨(alwaysPrepared)
      if (s.prepared === true || s.alwaysPrepared === true) return true;
      
      // 3. 정의(definition) 자체에 alwaysPrepared가 박혀있는 경우 (권역 주문 등)
      if (def.alwaysPrepared === true) return true;

      // 4. 아는 주문으로 취급(countsAsKnownSpell - 바드/소서러/워락 등)
      // 주의: 클레릭 같은 준비 직업은 이게 false일 수 있음
      if (s.countsAsKnownSpell === true) return true;

      // 5. 활성화됨(active) or 부여됨(granted) - 아이템/피트/특성
      if (s.active === true || s.granted === true) return true;

      // 6. [추가] 제한적 사용(limitedUse)이 있으면 보통 특수 능력으로 얻은 주문임
      if (s.limitedUse) return true;

      // 7. [비상] "Domain"이나 "Circle" 주문 등은 출처(sourceId)나 태그로 구분이 어렵지만,
      //    D&D Beyond 버그로 flags가 모두 false인 경우가 있음.
      //    만약 '항상 준비'되어야 하는 특수 주문이라면 보통 tooltip이나 activation 정보가 있음.
      //    여기서는 너무 많이 거르지 않기 위해, 준비된 주문 목록에 '강제로 끼워넣어진' 주문들을 체크.
      
      // 8. 사용자가 커스텀으로 추가한 주문 (isCustom)
      if (s.isCustom) return true;

      return false;
    });

    if (validSpells.length === 0) return;

    // 헤더 출력
    if (showHeader) {
      const abilityMod = basic.abilityMods[abilityKey as keyof typeof basic.abilityMods] ?? 0;
      const itemDc = basic.spellSaveDcBonus ?? 0;
      const itemAtk = basic.spellAttackBonusBonus ?? 0;
      
      const saveDc = 8 + basic.proficiencyBonus + abilityMod + itemDc;
      const attackBonus = basic.proficiencyBonus + abilityMod + itemAtk;

      lines.push(`### ${title} [기반: ${abilityKey.toUpperCase()}]`);
      lines.push(`(DC ${saveDc} / 명중 +${attackBonus})`);
      lines.push("");
    }

    // 분류용 바구니
    const allSpells: string[] = [];
    const attackSpells: string[] = [];
    const saveSpells: string[] = [];
    const otherSpells: string[] = [];

    for (const s of validSpells) {
      const def = s.definition;
      const name = def.name ?? "Unknown";
      
      // 중복 방지
      if (allSpells.includes(name)) continue;

      allSpells.push(name);

      if (def.requiresAttackRoll) {
        attackSpells.push(name);
      } else if (def.requiresSavingThrow) {
        saveSpells.push(name);
      } else {
        otherSpells.push(name);
      }

      // 데미지 파싱
      const mods = def.modifiers;
      if (Array.isArray(mods)) {
        const dmgMods = mods.filter((m: any) => m.type === "damage");
        if (dmgMods.length > 0) {
          const parts = dmgMods.map((m: any) => {
            const dice = m.die?.diceString ?? m.die?.fixedValue ?? "?";
            const type = m.subType ?? "damage";
            return `${dice} ${type}`;
          });
          damageInfoList.push(`${name}:${parts.join(" + ")}`);
        }
      }
    }

    // 정렬
    const sortFn = (a: string, b: string) => a.localeCompare(b);
    allSpells.sort(sortFn);
    attackSpells.sort(sortFn);
    saveSpells.sort(sortFn);
    otherSpells.sort(sortFn);

    // 출력
    lines.push(...allSpells);
    lines.push("");

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
    
    lines.push("--------------------------------");
    lines.push("");
  };

  // ====================================================
  // 2. 클래스 주문 처리
  // ====================================================
  if (Array.isArray(rawClassSpells)) {
    for (const classSpellGroup of rawClassSpells) {
      const classId = classSpellGroup?.characterClassId;
      const classDef = Array.isArray(rawClasses) 
        ? rawClasses.find((c: any) => c.id === classId) 
        : null;
      
      const className = classDef?.definition?.name ?? "Unknown Class";
      const abilityKey = getSpellAbility(classDef);

      processSpellList(classSpellGroup?.spells, className, abilityKey, true);
    }
  }

  // ====================================================
  // 3. 기타 주문 처리 (종족, 피트, 아이템, 플랫 클래스)
  // ====================================================
  // flatClassSpells는 가끔 DDB가 구조를 다르게 줄 때를 대비한 비상용입니다.
  const extraSpells = [...spellsRace, ...spellsFeat, ...spellsItem, ...spellsBg, ...flatClassSpells];
  if (extraSpells.length > 0) {
    processSpellList(extraSpells, "특수/종족/피트/아이템", "wis", true);
  }

  // ====================================================
  // 4. 데미지 정보 푸터
  // ====================================================
  if (damageInfoList.length > 0) {
    const uniqDmg = Array.from(new Set(damageInfoList)).sort();
    
    lines.push("----------------");
    lines.push("[주문 피해량 참고]");
    lines.push(...uniqDmg);
    lines.push("");
  }

  if (lines.length === 0) return "준비된 주문이 없습니다.";

  return lines.join("\n").trim();
}