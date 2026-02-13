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
  // 1. 데이터 소스 확보 (모든 구멍을 다 뒤짐)
  // ====================================================
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells ?? [];
  const rawClasses = ddb?.classes ?? ddb?.character?.classes ?? [];
  
  // 혹시 모를 누락 대비 (Flat List)
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

    // 🔥 [핵심 수정] 필터링 로직을 "관대하게" 변경 (엄격한 true 체크 제거)
    const validSpells = spells.filter(s => {
      const def = s?.definition;
      if (!def) return false;
      const lvl = def.level ?? 0;

      // 1. 소마법(0레벨)은 목록에 있다면 무조건 사용 가능 (Learned Cantrip)
      if (lvl === 0) return true;
      
      // 2. 준비됨(Prepared) 관련 플래그 확인 (Truthy 체크로 변경)
      // DDB 데이터가 가끔 true 대신 1이나 문자열을 줄 수도 있음
      if (s.prepared || s.alwaysPrepared) return true;
      
      // 3. 도메인 주문 등 정의(Def) 자체에 항상 준비됨이 박힌 경우
      if (def.alwaysPrepared) return true;

      // 4. 아는 주문(Known) 취급
      if (s.countsAsKnownSpell || s.isKnown) return true;

      // 5. 활성화됨(Active) / 부여됨(Granted)
      if (s.active || s.granted) return true;

      // 6. 제한적 사용(Limited Use)이 있는 경우 (종족/피트 특수 능력 등)
      if (s.limitedUse) return true;

      // 7. 커스텀 주문 (사용자가 직접 추가)
      if (s.isCustom) return true;

      // 8. [신규] 주문 준비 모드(preparationMode) 확인
      // 0: Prepared (준비 필요), 1: Known (알면 씀), 2: At Will (무한), 4: Domain (항상 준비?)
      // 모드가 0이 아니면(즉, Known이나 At Will 등이면) 준비 플래그가 없어도 사용 가능할 수 있음
      if (s.preparationMode && s.preparationMode !== 0) return true;

      // 9. [비상] 만약 위 조건 다 통과 못했는데 'Class Spell' 목록에 있고 레벨이 1 이상이라면?
      // 보통은 준비 안 된 주문(전체 리스트)이므로 거르는 게 맞음.
      // 하지만 Domain 주문이 버그로 Flags가 다 꺼져있을 수 있음.
      // 여기서는 안전을 위해 일단 스킵하지만, 정 안되면 이 주석을 풀어서 다 가져와야 함.
      
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
      
      // ✅ [수정] 이름 우선순위: 사용자가 바꾼 이름(overrideName) > 원래 이름(name)
      // 이렇게 하면 "Sacred Flame"을 "Holy Word"로 이름만 바꿨을 때 혼동을 줄일 수 있습니다.
      const name = s.overrideName || def.name || "Unknown";
      
      // 중복 방지 (같은 이름이 여러 출처에서 올 수 있음)
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