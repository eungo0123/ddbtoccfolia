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
  // 1. 주문 데이터 전수 조사 (모든 구멍 다 뒤지기)
  // ====================================================
  const allSpells: any[] = [];
  
  // (1) 기본 위치: classSpells (준비된 주문)
  const rawClassSpells = ddb?.classSpells ?? ddb?.character?.classSpells;
  if (Array.isArray(rawClassSpells)) {
     for (const group of rawClassSpells) {
         if (Array.isArray(group.spells)) allSpells.push(...group.spells);
     }
  }

  // (2) 기타 위치: spells object (종족, 피트, 아이템)
  const spellsObj = ddb?.spells ?? ddb?.character?.spells;
  if (spellsObj && typeof spellsObj === 'object') {
      for (const key of Object.keys(spellsObj)) {
          const val = spellsObj[key];
          if (Array.isArray(val)) {
              allSpells.push(...val);
          }
      }
  }

  // (3) 🔥 핵심: 서브클래스 피쳐 내부에 숨은 주문 강제 추출 (여기에 Bless가 숨어있음!)
  // 기존 코드에 이 부분이 없어서 권역 주문을 못 찾았던 것입니다.
  const classes = ddb?.classes ?? ddb?.character?.classes;
  if (Array.isArray(classes)) {
      for (const cls of classes) {
          // A. 클래스 객체 내부에 classSpells가 직접 박혀있는 경우
          if (Array.isArray(cls.classSpells)) allSpells.push(...cls.classSpells);

          // B. 서브클래스 및 클래스 기능(Feature) 전수 조사
          const feats = [
              ...(cls.definition?.classFeatures ?? []),      // 기본 클래스 피쳐
              ...(cls.subclassDefinition?.classFeatures ?? []), // 서브클래스 피쳐 (권역 주문)
              ...(cls.classFeatures ?? [])                   // 캐릭터 적용 피쳐
          ];
          
          for (const f of feats) {
              // 피쳐 안에 'spells' 배열이 있으면 가져옴
              if (Array.isArray(f.spells)) {
                  allSpells.push(...f.spells);
              }
              // 피쳐 정의(definition) 안에 'spells'가 있으면 가져옴
              if (f.definition && Array.isArray(f.definition.spells)) {
                  allSpells.push(...f.definition.spells);
              }
          }
      }
  }

  // ====================================================
  // 2. 필터링 및 중복 제거
  // ====================================================
  const validSpells: any[] = [];
  const hiddenSpells: string[] = []; 
  const seenNames = new Set<string>(); // 이름 기준 중복 방지

  for (const s of allSpells) {
    const def = s?.definition ?? s; // 구조가 다를 수 있음 (피쳐에서 가져온 건 구조가 다름)
    if (!def || !def.name) continue;

    const name = String(s.overrideName || def.name).trim();
    
    // 중복 제거 (이미 등록된 주문이면 스킵)
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const lvl = def.level ?? 0;

    // 1. 소마법(0레벨)은 무조건 통과
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
      // 준비되지 않은 주문이라도 '미준비 목록'에라도 표시 (누락 방지)
      hiddenSpells.push(name);
    }
  }

  if (validSpells.length === 0 && hiddenSpells.length === 0) return "주문 없음";

  // ====================================================
  // 3. 출력 생성
  // ====================================================
  
  // 메인 스탯 찾기 (헤더용)
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

  // [2] 숨겨진/미준비 주문 목록 (권역 주문이 여기 들어있을 수도 있음)
  if (hiddenSpells.length > 0) {
      hiddenSpells.sort((a, b) => a.localeCompare(b));
      lines.push("----------------");
      lines.push("[준비되지 않음 / 기타 (데이터 존재)]");
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