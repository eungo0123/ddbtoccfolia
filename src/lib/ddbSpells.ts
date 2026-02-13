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
  
  // (1) 표준 위치: classSpells
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells;
  if (Array.isArray(rawClassSpells)) {
     for (const group of rawClassSpells) {
         if (Array.isArray(group.spells)) allSpells.push(...group.spells);
     }
  }

  // (2) 표준 위치: spells object (race, feat, item, background 등)
  const spellsObj = ddb?.spells ?? ddb?.character?.spells;
  if (spellsObj && typeof spellsObj === 'object') {
      for (const key of Object.keys(spellsObj)) {
          const val = spellsObj[key];
          if (Array.isArray(val)) {
              allSpells.push(...val);
          }
      }
  }

  // (3) 비표준 위치: Classes 내부 구조 탐색 (서브클래스 피쳐 등)
  const classes = ddb?.classes ?? ddb?.character?.classes;
  if (Array.isArray(classes)) {
      for (const cls of classes) {
          // A. 클래스 내부에 classSpells가 박혀있는 경우
          if (Array.isArray(cls.classSpells)) allSpells.push(...cls.classSpells);

          // B. 클래스/서브클래스 "기능(Feature)"이 주문을 부여하는 경우 (권역 주문이 여기 숨기도 함)
          const features = [
              ...(cls.definition?.classFeatures ?? []),
              ...(cls.subclassDefinition?.classFeatures ?? []),
              ...(cls.classFeatures ?? [])
          ];
          
          for (const feat of features) {
              if (Array.isArray(feat.spells)) allSpells.push(...feat.spells);
              // definition 안에 spells가 있는 경우
              if (feat.definition && Array.isArray(feat.definition.spells)) {
                  allSpells.push(...feat.definition.spells);
              }
          }
      }
  }

  // ====================================================
  // 2. 수집된 주문 필터링 및 분류
  // ====================================================
  const validSpells: any[] = [];
  const hiddenSpells: string[] = []; // 준비 안 됨 (이름만 저장)
  const seenNames = new Set<string>(); // 중복 제거용

  for (const s of allSpells) {
    const def = s?.definition ?? s; // 구조가 다를 수 있으므로 폴백
    if (!def || !def.name) continue;

    const name = String(s.overrideName || def.name).trim();
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const lvl = def.level ?? 0;

    // 🔥 [판정 로직]
    // 1. 소마법(0레벨)은 무조건 통과
    if (lvl === 0) {
      validSpells.push(s);
      continue;
    }
    
    // 2. 준비된 주문인지 확인 (조건 관대하게)
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
      s.isCustom ||
      // [비상] 도메인 주문 이름 강제 확인 (권역 주문이 자주 누락되므로)
      ["Bless", "Spiritual Weapon", "Cure Wounds", "Lesser Restoration"].includes(def.name);

    if (isPrepared) {
      validSpells.push(s);
    } else {
      // 준비되지 않음 -> "숨겨진 주문 목록"으로 보냄
      hiddenSpells.push(name);
    }
  }

  if (validSpells.length === 0 && hiddenSpells.length === 0) return "주문 없음";

  // ====================================================
  // 3. 출력 생성
  // ====================================================
  // 헤더 생성 (메인 스탯 추적)
  let mainAbility = "wis"; 
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

  for (const s of validSpells) {
      const def = s.definition ?? s;
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

  // [1] 준비된 주문 전체 목록
  const allNames = [...groups.attack, ...groups.save, ...groups.other].sort((a, b) => a.localeCompare(b));
  if (allNames.length > 0) {
      lines.push(...allNames);
      lines.push("");
      
      printGroup(groups.attack, "명중 주문");
      printGroup(groups.save, "내성굴림 주문");
      printGroup(groups.other, "기타/치유/버프");
  }

  // [2] 숨겨진/미준비 주문 목록 (여기에 Bless가 있는지 확인하세요!)
  if (hiddenSpells.length > 0) {
      hiddenSpells.sort((a, b) => a.localeCompare(b));
      lines.push("----------------");
      lines.push("[미준비/기타 주문 (데이터 존재함)]");
      lines.push(hiddenSpells.join(", "));
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