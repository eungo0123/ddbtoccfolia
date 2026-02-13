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
  // 1. 주문 데이터 "영혼까지 끌어모으기" (Deep Collection)
  // ====================================================
  const allSpells: any[] = [];
  
  // (1) 표준 위치: classSpells (Root or Character)
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells;
  if (Array.isArray(rawClassSpells)) {
     for (const group of rawClassSpells) {
         if (Array.isArray(group.spells)) allSpells.push(...group.spells);
     }
  }

  // (2) 표준 위치: spells object (race, feat, item, class, etc...)
  // spells 객체 안에 있는 '모든 키'를 다 뒤집니다. (global, unique 등 비표준 키 대응)
  const spellsObj = ddb?.spells ?? ddb?.character?.spells;
  if (spellsObj && typeof spellsObj === 'object') {
      for (const key of Object.keys(spellsObj)) {
          const val = spellsObj[key];
          if (Array.isArray(val)) {
              allSpells.push(...val);
          }
      }
  }

  // (3) 비표준 위치: Classes 내부의 classSpells (중첩된 경우)
  const classes = ddb?.classes ?? ddb?.character?.classes;
  if (Array.isArray(classes)) {
      for (const cls of classes) {
          // 클래스 객체 안에 classSpells가 직접 들어있는 변칙 케이스 대응
          if (Array.isArray(cls.classSpells)) { 
              allSpells.push(...cls.classSpells);
          }
      }
  }

  // ====================================================
  // 2. 수집된 주문 처리 및 필터링
  // ====================================================
  
  // 분류용 바구니
  const validSpells: any[] = [];
  const unpreparedNames: string[] = []; // 준비 안 됨 (이름만 저장)
  const seenNames = new Set<string>();  // 중복 제거용

  for (const s of allSpells) {
    const def = s?.definition;
    if (!def) continue; // 정의 없으면 스킵

    const name = String(s.overrideName || def.name || "Unknown").trim();
    if (!name || seenNames.has(name)) continue; // 이미 처리했으면 스킵
    seenNames.add(name);

    const lvl = def.level ?? 0;

    // 1. 소마법(0레벨)은 무조건 통과
    if (lvl === 0) {
      validSpells.push(s);
      continue;
    }
    
    // 2. 준비된 주문인지 확인 (조건 대폭 완화)
    const isPrepared = 
      s.prepared || 
      s.alwaysPrepared || 
      s.countsAsKnownSpell || 
      def.alwaysPrepared ||     // 정의상 항상 준비 (권역 주문)
      s.active ||               // 활성화됨
      s.granted ||              // 부여됨
      s.limitedUse ||           // 사용 횟수 제한 있음
      (s.preparationMode && s.preparationMode !== 0) || // 준비 모드가 0(Prepared)이 아님
      s.isKnown ||              // 아는 주문
      s.overrideName ||         // 이름 바꿈 (사용자가 건드림)
      s.isCustom;               // 커스텀

    if (isPrepared) {
      validSpells.push(s);
    } else {
      // 준비되지 않음 -> 미준비 목록에 추가 (혹시 모르니)
      unpreparedNames.push(name);
    }
  }

  if (validSpells.length === 0 && unpreparedNames.length === 0) return "주문 없음";

  // ====================================================
  // 3. 출력 생성
  // ====================================================

  // 헤더 (기반 능력치는 가장 높은 클래스 기준이나 WIS로 통일)
  // 여기서는 가장 일반적인 'WIS'(클레릭) 기준으로 DC/명중을 찍어주거나 생략할 수 있습니다.
  // 정확도를 위해 메인 클래스를 찾습니다.
  let mainAbility = "wis"; // 기본값
  if (Array.isArray(classes)) {
      for (const cls of classes) {
          if (cls.isStartingClass) {
             mainAbility = getSpellAbility(cls);
             break;
          }
      }
  }
  
  const abilityMod = basic.abilityMods[mainAbility as keyof typeof basic.abilityMods] ?? 0;
  const saveDc = 8 + basic.proficiencyBonus + abilityMod + (basic.spellSaveDcBonus ?? 0);
  const attackBonus = basic.proficiencyBonus + abilityMod + (basic.spellAttackBonusBonus ?? 0);
  
  lines.push(`### Spellcasting [기반: ${mainAbility.toUpperCase()}]`);
  lines.push(`(DC ${saveDc} / 명중 +${attackBonus})`);
  lines.push("");

  const groups: Record<string, string[]> = {
      attack: [], save: [], other: []
  };
  const dmgList: string[] = [];

  // 유효한 주문 분류
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

  const printGroup = (list: string[], label?: string) => {
      if (list.length === 0) return;
      list.sort((a, b) => a.localeCompare(b));
      if (label) lines.push(`[${label}]`);
      lines.push(...list);
      lines.push("");
  };

  // 1. 전체 목록 (알파벳순)
  const allNames = [...groups.attack, ...groups.save, ...groups.other].sort((a, b) => a.localeCompare(b));
  if (allNames.length > 0) {
      lines.push(...allNames);
      lines.push("");
      
      printGroup(groups.attack, "명중 주문");
      printGroup(groups.save, "내성굴림 주문");
      printGroup(groups.other, "기타/치유/버프");
  }

  // 2. 미준비 목록 (권역 주문이 여기 빠져있을 수도 있음)
  if (unpreparedNames.length > 0) {
      unpreparedNames.sort((a, b) => a.localeCompare(b));
      lines.push("----------------");
      lines.push("[준비되지 않은 주문 / 기타]");
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
  
  return lines.length > 0 ? lines.join("\n").trim() : "주문 없음";
}