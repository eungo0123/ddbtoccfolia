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
  // 1. 데이터 소스 확보
  // ====================================================
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells ?? [];
  const rawClasses = ddb?.classes ?? ddb?.character?.classes ?? [];
  
  const spellsRace = ddb?.spells?.race ?? ddb?.character?.spells?.race ?? [];
  const spellsFeat = ddb?.spells?.feat ?? ddb?.character?.spells?.feat ?? [];
  const spellsItem = ddb?.spells?.item ?? ddb?.character?.spells?.item ?? [];
  const spellsBg = ddb?.spells?.background ?? ddb?.character?.spells?.background ?? [];

  // 데미지 정보 수집용
  const damageInfoList: string[] = [];

  console.log("=== [DDB Spells Debug Start] ===");

  // 헬퍼: 주문 목록 처리 및 출력
  const processSpellList = (spells: any[], title: string, abilityKey: string, showHeader: boolean) => {
    if (!Array.isArray(spells) || spells.length === 0) return;

    // 분류용 바구니
    const allSpells: string[] = [];
    const attackSpells: string[] = [];
    const saveSpells: string[] = [];
    const otherSpells: string[] = [];
    
    // ✅ [추가] 준비되지 않았지만 리스트에 있는 주문들
    const unpreparedSpells: string[] = [];

    for (const s of spells) {
      const def = s?.definition;
      if (!def) continue;
      
      const name = s.overrideName || def.name || "Unknown";
      const lvl = def.level ?? 0;
      
      // 디버깅 로그 출력 (F12 콘솔 확인용)
      // "Bless" 같은 주문이 왜 false인지 확인 가능
      const isPrepared = s.prepared || s.alwaysPrepared || def.alwaysPrepared || s.countsAsKnownSpell || s.active || s.granted || s.limitedUse || s.isCustom || (s.preparationMode && s.preparationMode !== 0);
      
      // ✅ [강제 표시 정책]
      // 1. 준비된 주문은 당연히 표시 (Pass)
      // 2. 준비되지 않았어도(false), "소마법(lvl 0)"은 표시
      // 3. 준비되지 않았어도, 리스트에 존재한다면 "(미준비)" 태그를 달고 표시 (디버깅 목적 및 누락 방지)
      //    -> 단, 클레릭 전체 주문 목록(100개+)이 쏟아지는 걸 막기 위해, 'active'나 'flags' 등을 볼 수도 있지만,
      //       사용자가 "Bless가 없다"고 했으므로 일단 다 보여주는게 낫습니다. 
      //       다만 너무 많으면 곤란하니, 일단 로그에는 다 찍고, 리스트에는 '준비된 것' 위주로 넣되
      //       만약 사용자가 정말 원한다면 보이게 해야 합니다.
      //       여기서는 "준비 여부"를 체크해서 통과하면 normal, 아니면 unprepared 목록에 넣습니다.

      let finalInclude = false;
      let tag = "";

      if (isPrepared) {
        finalInclude = true;
      } else if (lvl === 0) {
        finalInclude = true; // 소마법은 무조건
      } else {
        // 준비 안 된 주문 -> "(미준비)" 목록으로 보냄
        // 단, 클레릭처럼 전체 리스트(classSpells)를 다 주는 경우 너무 많을 수 있음.
        // 여기서는 콘솔에만 찍고 넘어가거나, 아니면 특정 주문(Bless 등)만 살릴 수는 없음.
        // 절충안: unpreparedSpells 배열에 담아두고, 섹션을 분리해서 보여줌.
        unpreparedSpells.push(name);
        console.log(`[SKIP] ${name} (Lvl ${lvl}) - Prepared: ${s.prepared}, Always: ${s.alwaysPrepared}`);
        continue; 
      }
      
      console.log(`[OK] ${name} (Lvl ${lvl})`);

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
    unpreparedSpells.sort(sortFn); // 미준비 목록 정렬

    if (allSpells.length === 0 && unpreparedSpells.length === 0) return;

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

    if (allSpells.length > 0) {
        lines.push(...allSpells);
        lines.push("");
    }

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

    // ✅ [추가] 미준비 목록 출력 (디버깅용)
    // 만약 Bless가 여기 들어있다면 DDB에서 prepared 체크를 안 한 것입니다.
    if (unpreparedSpells.length > 0) {
        // 너무 많으면(20개 이상) 접거나 생략해야겠지만, 일단 원인을 찾기 위해 상위 10개만 예시로 보여주거나 다 보여줍니다.
        // 클레릭은 전체 주문을 다 알기 때문에 이 목록이 매우 길 수 있습니다.
        // 따라서, "Bless"나 "Spiritual Weapon" 같이 사용자가 찾던 주문이 여기에 있는지 확인이 필요합니다.
        
        // 일단 주석 처리하지 않고, 별도 섹션으로 표시합니다.
        lines.push("----------------");
        lines.push("[준비되지 않음(Data) - 확인용]");
        lines.push("(D&D Beyond에서 'Prepare' 버튼을 눌렀는지 확인하세요)");
        lines.push(...unpreparedSpells);
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
  // 3. 기타 주문 처리
  // ====================================================
  const extraSpells = [...spellsRace, ...spellsFeat, ...spellsItem, ...spellsBg];
  if (extraSpells.length > 0) {
    processSpellList(extraSpells, "특수/종족/피트/아이템", "wis", true);
  }

  console.log("=== [DDB Spells Debug End] ===");

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

  if (lines.length === 0) return "표시할 주문이 없습니다.";

  return lines.join("\n").trim();
}