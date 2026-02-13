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

// 🚫 [차단 목록]
const BLOCK_KEYWORDS = [
  "Rune", "Fighting Style", "Second Wind", "Action Surge", "Giant",
  "Relentless", "Channel Divinity", "Lay on Hands", "Divine Smite",
  "Form of Dread", "Wild Shape", "Starry Form", "Breath Weapon"
];

// 🔧 [안전장치 1] 능력치 수정치 구하기
function getSafeStatMod(ddb: any, basic: NormalizedBasic, statName: 'str' | 'dex'): number {
  if (basic.abilityMods[statName] !== 0) return basic.abilityMods[statName];
  
  const stats = ddb?.character?.stats ?? ddb?.stats;
  if (!Array.isArray(stats)) return 0;
  
  const idx = statName === 'str' ? 0 : 1;
  const val = stats[idx]?.value ?? 10;
  return Math.floor((val - 10) / 2);
}

// 🔧 [안전장치 2] 숙련 보너스 구하기
function getSafeProficiency(ddb: any, basic: NormalizedBasic): number {
  if (basic.proficiencyBonus > 0) return basic.proficiencyBonus;
  
  const classes = ddb?.character?.classes ?? ddb?.classes ?? [];
  let level = 0;
  for (const c of classes) level += (c.level ?? 0);
  if (level === 0) level = 1;

  if (level >= 17) return 6;
  if (level >= 13) return 5;
  if (level >= 9) return 4;
  if (level >= 5) return 3;
  return 2;
}

export function extractAttacks(ddb: any, basic: NormalizedBasic): AttackItem[] {
  const found: AttackItem[] = [];
  const foundNames = new Set<string>();

  const strMod = getSafeStatMod(ddb, basic, 'str');
  const dexMod = getSafeStatMod(ddb, basic, 'dex');
  const prof = getSafeProficiency(ddb, basic);

  // ====================================================
  // 1. 인벤토리(Inventory) 털기
  // ====================================================
  const inventory = ddb?.character?.inventory ?? ddb?.inventory;
  
  if (Array.isArray(inventory)) {
    for (const item of inventory) {
      if (!item.equipped) continue;

      const def = item.definition;
      const name = def?.name;
      if (!name) continue;

      if (BLOCK_KEYWORDS.some(k => name.includes(k))) continue;

      const type = String(def.type ?? "").toLowerCase();
      if (type.includes("armor") || type.includes("shield")) continue;

      const dmgObj = def.damage;
      if (!dmgObj || (!dmgObj.diceString && !dmgObj.fixedValue)) continue;

      const props = def.properties ?? [];
      const isFinesse = Array.isArray(props) && props.some((p: any) => p.name === "Finesse");
      const isRanged = def.attackType === 2 || (def.range && def.range > 5);
      const isThrown = Array.isArray(props) && props.some((p: any) => p.name === "Thrown");
      
      let mod = strMod;
      if (isRanged && !isThrown) mod = dexMod;
      else if (isFinesse) mod = Math.max(strMod, dexMod);
      
      const isProf = item.isProficient !== false;
      
      let magicBonus = 0;
      if (def.grantedModifiers) {
          for (const m of def.grantedModifiers) {
              if (m.type === "bonus" && m.subType === "magic") magicBonus = Number(m.value) || 0;
          }
      }
      if (magicBonus === 0 && def.magic) magicBonus = 1;

      // 🔥 [안전장치] 마법 보너스가 +10을 넘으면 0으로 초기화
      if (Math.abs(magicBonus) > 10) magicBonus = 0;

      // ✅ [강제 계산]
      const attackBonus = mod + (isProf ? prof : 0) + magicBonus;

      let damage = dmgObj.diceString ?? (dmgObj.fixedValue ? String(dmgObj.fixedValue) : "");
      if (damage.includes("d") && !damage.includes("+") && !damage.includes("-")) {
          const totalDmgMod = mod + magicBonus;
          if (totalDmgMod !== 0) damage += (totalDmgMod > 0 ? `+${totalDmgMod}` : `${totalDmgMod}`);
      }

      const dmgTypeId = def.damageTypeId;
      const rawType = dmgTypeId ? getDamageTypeFromId(dmgTypeId) : "";
      const damageType = DAMAGE_TYPE_KO[rawType] ?? rawType;

      let range = "5ft";
      if (def.range) {
         range = `${def.range}ft`;
         if (def.longRange) range += `/${def.longRange}ft`;
      }

      found.push({
        name,
        range,
        attackBonus,
        damage,
        damageType,
        isMagic: magicBonus > 0 || def.magic,
        notes: "인벤토리 장비",
        source: "inventory"
      });
      foundNames.add(name);
    }
  }

  // ====================================================
  // 2. Actions 탭 털기
  // ====================================================
  const actionsRoot = ddb?.character?.actions ?? ddb?.actions ?? {};
  const actionKeys = Object.keys(actionsRoot);

  for (const key of actionKeys) {
    const acts = actionsRoot[key];
    if (!Array.isArray(acts)) continue;

    for (const act of acts) {
      const name = act.name || act.definition?.name;
      if (!name) continue;

      if (foundNames.has(name)) continue;
      if (BLOCK_KEYWORDS.some(k => name.includes(k))) continue;
      
      const dmgObj = act.damage ?? act.definition?.damage;
      const hasDamage = !!(dmgObj?.diceString || dmgObj?.fixedValue);
      const isAttackFlag = act.displayAsAttack === true || act.isAttack === true;
      const hasToHit = act.toHit != null || act.toHitBonus != null;

      if (!isAttackFlag && !hasDamage && !hasToHit) continue;

      // --- 명중 보너스 계산 ---
      const bestMod = Math.max(strMod, dexMod);
      
      // ✅ [핵심 수정] D&D Beyond의 `toHit` 값 무시
      let rawBonus = act.toHitBonus ?? 0;

      // 🔥 [안전장치]
      if (Math.abs(rawBonus) > 10) rawBonus = 0;

      const attackBonus = bestMod + prof + rawBonus;

      // --- 데미지 계산 ---
      let damage = "";
      if (dmgObj) {
        damage = dmgObj.diceString ?? (dmgObj.fixedValue ? String(dmgObj.fixedValue) : "");
        if (damage.includes("d") && !damage.includes("+") && !damage.includes("-")) {
             if (bestMod !== 0) damage += (bestMod > 0 ? `+${bestMod}` : `${bestMod}`);
        }
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
  // 3. 맨손 공격 비상 추가
  // ====================================================
  if (!foundNames.has("Unarmed Strike") && !foundNames.has("맨손 공격")) {
      const hit = strMod + prof;
      const dmg = 1 + strMod;

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
    let notePart = "";
    
    if (atk.notes && atk.notes !== "인벤토리 장비" && atk.notes !== "기본 맨손 공격") {
        notePart = `\n> ${atk.notes}`;
    }
    
    lines.push(`1d20${sign}${atk.attackBonus} ${atk.name}${magicMark} (${atk.range})${dmgPart}${notePart}`);
  }

  return lines.join("\n");
}