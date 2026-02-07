// src/lib/ddbAttacks.ts
import { NormalizedBasic, NormalizedAttack } from "./ddbNormalize";

const DAMAGE_TYPE_KO: Record<string, string> = {
  bludgeoning: "타격",
  piercing: "관통",
  slashing: "참격",
  acid: "산성",
  cold: "냉기",
  fire: "화염",
  force: "역장",
  lightning: "전격",
  necrotic: "사령",
  poison: "독",
  psychic: "정신",
  radiant: "광휘",
  thunder: "천둥",
};

function getDamageTypeFromId(id: number): string {
  switch (id) {
    case 1: return "bludgeoning";
    case 2: return "piercing";
    case 3: return "slashing";
    case 4: return "necrotic";
    case 5: return "acid";
    case 6: return "cold";
    case 7: return "fire";
    case 8: return "lightning";
    case 9: return "thunder";
    case 10: return "poison";
    case 11: return "psychic";
    case 12: return "radiant";
    case 13: return "force";
    default: return "";
  }
}

export function extractAttacks(ddb: any, basic: NormalizedBasic): NormalizedAttack[] {
  const found: NormalizedAttack[] = [];

  // D&D Beyond의 Actions 데이터 순회
  const actionsRoot = ddb?.character?.actions ?? ddb?.actions;
  if (!actionsRoot) return [];

  const categories = ["race", "class", "feat", "item", "custom"];

  for (const cat of categories) {
    const acts = actionsRoot[cat];
    if (!Array.isArray(acts)) continue;

    for (const act of acts) {
      // 공격 판정이 있는 행동만 추출 (displayAsAttack이 true이거나 명중 보너스가 있는 경우)
      if (act.displayAsAttack !== true && !act.isAttack && act.toHitBonus == null) continue;

      const name = act.name || "Unknown Attack";
      const attackBonus = act.toHitBonus ?? 0;
      
      // 사거리 (Range)
      let range = "5ft";
      const rangeObj = act.range ?? act.definition?.range;
      if (rangeObj) {
        if (rangeObj.range) range = `${rangeObj.range}ft`;
        if (rangeObj.long) range += `/${rangeObj.long}ft`;
      }
      
      // 마법 무기 여부
      const isMagic = act.isMagic ?? act.definition?.magic ?? false;

      // 데미지 파싱
      let damage = "";
      let damageType = "";

      // dice 값이 있는 경우 (예: {diceString: "1d8+3", ...})
      if (act.damage && act.damage.diceString) {
        damage = act.damage.diceString;
      }
      
      const dmgTypeId = act.damageTypeId;
      const rawType = dmgTypeId ? getDamageTypeFromId(dmgTypeId) : "";
      damageType = DAMAGE_TYPE_KO[rawType] ?? rawType;

      // 설명(notes)
      const snippet = act.snippet ?? "";
      const notes = snippet.length > 60 ? snippet.slice(0, 60) + "..." : snippet;

      found.push({
        name,
        range,       // ✅ 추가됨
        attackBonus,
        damage,
        damageType,
        isMagic,     // ✅ 추가됨
        notes,
      });
    }
  }

  return found;
}

export function buildAttackListKo(attacks: NormalizedAttack[], basic: NormalizedBasic): string {
  const lines: string[] = [];
  
  if (attacks.length === 0) return "공격 수단 없음";

  for (const atk of attacks) {
    const sign = atk.attackBonus >= 0 ? "+" : "";
    
    // 예: 1d20+5 Longsword (5ft) / 1d8+3 참격
    let dmgPart = "";
    if (atk.damage) {
      dmgPart = ` / ${atk.damage} ${atk.damageType}`;
    }
    
    const magicMark = atk.isMagic ? "[마법]" : "";
    
    lines.push(`1d20${sign}${atk.attackBonus} ${atk.name}${magicMark} (${atk.range})${dmgPart}`);
    if (atk.notes) {
       lines.push(`> ${atk.notes}`);
    }
  }

  return lines.join("\n");
}