// src/lib/ddbAttacks.ts
import { NormalizedBasic } from "./ddbNormalize";

export type AttackItem = {
  name: string;
  range: string;
  attackBonus: number;
  damage: string;
  damageType: string;
  isMagic: boolean;
  notes: string;
  source: string;
};

const DAMAGE_TYPE_KO: Record<string, string> = {
  bludgeoning: "타격", piercing: "관통", slashing: "참격",
  acid: "산성", cold: "냉기", fire: "화염", force: "역장",
  lightning: "전격", necrotic: "사령", poison: "독",
  psychic: "정신", radiant: "광휘", thunder: "천둥",
};

function getDamageTypeFromId(id: number): string {
  switch (id) {
    case 1: return "bludgeoning"; case 2: return "piercing"; case 3: return "slashing";
    case 4: return "necrotic"; case 5: return "acid"; case 6: return "cold";
    case 7: return "fire"; case 8: return "lightning"; case 9: return "thunder";
    case 10: return "poison"; case 11: return "psychic"; case 12: return "radiant";
    case 13: return "force"; default: return "";
  }
}

// 무기 판별 함수 (아주 너그럽게)
function isWeaponLike(def: any) {
  if (!def) return false;
  // filterType 3: 무기
  if (def.filterType === 3) return true;
  
  const type = String(def.type ?? "").toLowerCase();
  const subType = String(def.subType ?? "").toLowerCase();
  
  if (type.includes("weapon")) return true;
  if (subType.includes("weapon")) return true;
  
  // 데미지 주사위가 있으면 무기로 간주
  if (def.damage && (def.damage.diceString || def.damage.fixedValue)) return true;

  return false;
}

export function extractAttacks(ddb: any, basic: NormalizedBasic): AttackItem[] {
  const found: AttackItem[] = [];
  const foundNames = new Set<string>();

  // ====================================================
  // 1. [최우선] 인벤토리(Inventory) 뒤지기
  // 무기들은 보통 여기에만 정보가 제대로 있습니다.
  // ====================================================
  const inventory = ddb?.character?.inventory ?? ddb?.inventory;
  
  if (Array.isArray(inventory)) {
    for (const item of inventory) {
      // 1) 장착 여부 확인 (equipped가 true여야 함)
      if (!item.equipped) continue;

      const def = item.definition;
      const name = def?.name;
      if (!name) continue;

      // 2) 무기인지 확인 (너그럽게)
      if (!isWeaponLike(def)) continue;

      // 3) 데이터 추출
      // 명중 보너스 계산 (STR/DEX + 숙련)
      // DDB 데이터에는 계산된 값이 없을 수 있어 직접 추정합니다.
      let estimatedHit = 0;
      
      const strMod = basic.abilityMods["str"];
      const dexMod = basic.abilityMods["dex"];
      const prof = basic.proficiencyBonus;

      // Finesse(기교) 속성 확인
      const props = def.properties ?? [];
      const isFinesse = Array.isArray(props) && props.some((p: any) => p.name === "Finesse");
      
      // 원거리 확인
      const isRanged = def.attackType === 2 || (def.range && def.range > 5);
      
      // 능력치 선택 (원거리=DEX, 근거리=STR, 기교=높은거)
      let mod = strMod;
      if (isRanged) mod = dexMod;
      else if (isFinesse) mod = Math.max(strMod, dexMod);
      
      // +1 무기 등 마법 보너스 확인
      const magicBonus = def.magic ? 1 : 0; // 단순 +1 가정 (데이터가 복잡해서)
      // 실제로는 modifiers를 뒤져야 하지만, 기본적으로 item.definition.grantedModifiers 등을 봐야 함.
      // 여기서는 일단 생략하거나 기본값 사용.

      // 숙련 여부
      const isProf = item.isProficient;
      estimatedHit = mod + (isProf ? prof : 0) + magicBonus;

      // 데미지
      const dmgObj = def.damage;
      let damage = "";
      if (dmgObj) {
        damage = dmgObj.diceString ?? (dmgObj.fixedValue ? String(dmgObj.fixedValue) : "");
        // 무기 기본 데미지에 능력치 수정치 더하기
        if (damage.includes("d")) {
            damage += (mod >= 0 ? `+${mod}` : `${mod}`);
        }
      }

      const dmgTypeId = def.damageTypeId;
      const rawType = dmgTypeId ? getDamageTypeFromId(dmgTypeId) : "";
      const damageType = DAMAGE_TYPE_KO[rawType] ?? rawType;

      // 사거리
      let range = "5ft";
      if (def.range) {
         range = `${def.range}ft`;
         if (def.longRange) range += `/${def.longRange}ft`;
      }

      // 목록 추가
      found.push({
        name,
        range,
        attackBonus: estimatedHit,
        damage,
        damageType,
        isMagic: def.magic ?? false,
        notes: "인벤토리 장비",
        source: "inventory"
      });
      foundNames.add(name);
    }
  }

  // ====================================================
  // 2. Actions 탭 뒤지기 (특수 능력, 주문 공격 등)
  // 인벤토리에 없는 것들(Fire Rune 등)을 여기서 찾습니다.
  // ====================================================
  const actionsRoot = ddb?.character?.actions ?? ddb?.actions ?? {};
  const actionKeys = Object.keys(actionsRoot);

  for (const key of actionKeys) {
    const acts = actionsRoot[key];
    if (!Array.isArray(acts)) continue;

    for (const act of acts) {
      const name = act.name || act.definition?.name;
      if (!name) continue;

      // 이미 인벤토리에서 찾은 무기면 패스 (중복 방지)
      if (foundNames.has(name)) continue;

      // 필터: 공격이거나 데미지가 있거나 명중이 있어야 함
      const isAttackFlag = act.displayAsAttack === true || act.isAttack === true;
      const dmgObj = act.damage ?? act.definition?.damage;
      const hasDamage = !!(dmgObj?.diceString || dmgObj?.fixedValue);
      const hasToHit = act.toHit != null || act.toHitBonus != null;

      if (!isAttackFlag && !hasDamage && !hasToHit) continue;

      // 추출
      let attackBonus = 0;
      if (act.toHit != null) attackBonus = act.toHit;
      else if (act.toHitBonus != null) attackBonus = act.toHitBonus;

      let damage = "";
      if (dmgObj) {
        damage = dmgObj.diceString ?? (dmgObj.fixedValue ? String(dmgObj.fixedValue) : "");
      }

      const dmgTypeId = act.damageTypeId ?? act.definition?.damageTypeId;
      const rawType = dmgTypeId ? getDamageTypeFromId(dmgTypeId) : "";
      const damageType = DAMAGE_TYPE_KO[rawType] ?? rawType;
      
      let range = "5ft";
      const rangeObj = act.range ?? act.definition?.range;
      if (rangeObj) {
        if (rangeObj.range) range = `${rangeObj.range}ft`;
        if (rangeObj.long) range += `/${rangeObj.long}ft`;
      }

      let snippet = act.snippet ?? act.description ?? act.definition?.description ?? "";
      snippet = snippet.replace(/<[^>]*>?/gm, "");
      const notes = snippet.length > 50 ? snippet.slice(0, 50) + "..." : snippet;

      found.push({
        name,
        range,
        attackBonus: Number(attackBonus),
        damage,
        damageType,
        isMagic: act.isMagic ?? false,
        notes,
        source: "action"
      });
      foundNames.add(name);
    }
  }

  // ====================================================
  // 3. [비상] 맨손 공격(Unarmed Strike) 강제 추가
  // 데이터에 없어도 모든 캐릭터는 맨손 공격이 가능하므로 추가합니다.
  // ====================================================
  if (!foundNames.has("Unarmed Strike") && !foundNames.has("맨손 공격")) {
      const strMod = basic.abilityMods["str"];
      const prof = basic.proficiencyBonus; // 보통 맨손은 숙련됨
      const hit = strMod + prof;
      const dmg = 1 + strMod; // 기본 1 + STR

      found.push({
          name: "Unarmed Strike",
          range: "5ft",
          attackBonus: hit,
          damage: `${dmg}`,
          damageType: "타격",
          isMagic: false,
          notes: "기본 맨손 공격",
          source: "system"
      });
  }

  return found;
}

export function buildAttackListKo(attacks: AttackItem[], basic: NormalizedBasic): string {
  const lines: string[] = [];
  
  if (attacks.length === 0) return "공격 수단 없음";

  for (const atk of attacks) {
    const sign = atk.attackBonus >= 0 ? "+" : "";
    
    let dmgPart = "";
    if (atk.damage) {
      dmgPart = ` / ${atk.damage} ${atk.damageType}`;
    }
    
    const magicMark = atk.isMagic ? "[마법]" : "";
    
    // 메모는 너무 길면 지저분하니까, 인벤토리 출처는 깔끔하게 생략하거나 짧게
    let notePart = "";
    if (atk.notes && atk.notes !== "인벤토리 장비" && atk.notes !== "기본 맨손 공격") {
        notePart = `\n> ${atk.notes}`;
    }
    
    lines.push(`1d20${sign}${atk.attackBonus} ${atk.name}${magicMark} (${atk.range})${dmgPart}${notePart}`);
  }

  return lines.join("\n");
}