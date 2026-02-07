// src/lib/ddbAttacks.ts
import { NormalizedAttack } from "./ddbNormalize";

const DAMAGE_TYPE_KO: Record<string, string> = {
  bludgeoning: "타격",
  slashing: "참격",
  piercing: "관통",
  cold: "냉기",
  fire: "화염",
  lightning: "번개",
  acid: "산성",
  poison: "독",
  necrotic: "사령",
  radiant: "광휘",
  psychic: "정신",
  force: "역장",
  thunder: "천둥",
};

const WEAPON_PROP_KO: Record<string, string> = {
  ammunition: "탄약",
  finesse: "기교",
  heavy: "중량",
  light: "경량",
  loading: "장전",
  reach: "사거리(손 닿는 범위)",
  special: "특수",
  thrown: "투척",
  twohanded: "양손",
  versatile: "양손(가변)",
};

function toKoDamageType(x: any) {
  const k = String(x ?? "").toLowerCase();
  return DAMAGE_TYPE_KO[k] ?? String(x ?? "");
}

// ---------- (A) actions / customActions 쪽 공격 후보를 재귀로 훑는 기존 방식 ----------
function collectObjectsDeep(root: any, out: any[] = []) {
  if (!root) return out;
  if (Array.isArray(root)) {
    for (const v of root) collectObjectsDeep(v, out);
    return out;
  }
  if (typeof root === "object") {
    out.push(root);
    for (const v of Object.values(root)) collectObjectsDeep(v, out);
    return out;
  }
  return out;
}

function looksLikeAttack(o: any) {
  if (!o || typeof o !== "object") return false;
  const nameOk = typeof o.name === "string" && o.name.length > 0;
  const hasToHit = o.toHit != null;
  const hasDamageArr = Array.isArray(o.damage) && o.damage.length > 0;
  const t = String(o.actionType ?? "").toLowerCase();
  const typeOk = t === "attack" || t === "weapon" || t === "melee" || t === "ranged";
  return nameOk && (typeOk || (hasToHit && hasDamageArr));
}

function extractAttacksFromActions(ddb: any): NormalizedAttack[] {
  const found: NormalizedAttack[] = [];
  const pool = collectObjectsDeep(ddb?.actions, []);
  collectObjectsDeep(ddb?.customActions, pool);

  for (const o of pool) {
    if (!looksLikeAttack(o)) continue;

    const dmg0 = Array.isArray(o.damage) ? o.damage[0] : null;
    let damage = "";
    let damageType = "";

    if (dmg0) {
      const diceCount = Number(dmg0?.diceCount ?? 0);
      const diceValue = Number(dmg0?.diceValue ?? 0);
      const fixedValue = Number(dmg0?.fixedValue ?? 0);

      damage =
        diceCount && diceValue
          ? `${diceCount}d${diceValue}${fixedValue ? `+${fixedValue}` : ""}`
          : fixedValue
          ? `${fixedValue}`
          : "";

      damageType = toKoDamageType(dmg0?.damageType);
    }

    found.push({
      name: o.name,
      attackBonus: Number(o?.toHit ?? 0),
      damage,
      damageType,
      notes: (typeof o?.notes === "string" ? o.notes : "") || (typeof o?.description === "string" ? o.description : ""),
    });
  }

  // 중복 제거
  const uniq = new Map<string, NormalizedAttack>();
  for (const a of found) {
    const key = `${a.name}|${a.attackBonus}|${a.damage}|${a.damageType}`;
    if (!uniq.has(key)) uniq.set(key, a);
  }
  return Array.from(uniq.values());
}

// ---------- (B) inventory(무기) 기반 공격 생성 ----------

// 가능한 형태들에서 “무기 정의”를 최대한 안전하게 꺼내기
function getItemDef(item: any) {
  return item?.definition ?? item?.itemDefinition ?? item?.def ?? null;
}

function isWeaponItem(item: any) {
  const def = getItemDef(item);
  if (!def) return false;

  // 흔한 단서들
  const filterType = String(def?.filterType ?? "").toLowerCase();
  const type = String(def?.type ?? "").toLowerCase();
  const subType = String(def?.subType ?? "").toLowerCase();

  // weaponBehaviors / damage 가 있으면 무기로 취급
  const hasDamage = !!def?.damage || (Array.isArray(def?.weaponBehaviors) && def.weaponBehaviors.length > 0);

  if (filterType.includes("weapon")) return true;
  if (type.includes("weapon")) return true;
  if (subType.includes("weapon")) return true;
  if (hasDamage) return true;

  return false;
}

// DDB 무기 damage 정보가 여러 형태라 최대한 커버
function getWeaponDamage(def: any) {
  // 형태 1) definition.damage
  if (def?.damage) return def.damage;

  // 형태 2) weaponBehaviors[0].damage
  const wb0 = Array.isArray(def?.weaponBehaviors) ? def.weaponBehaviors[0] : null;
  if (wb0?.damage) return wb0.damage;

  return null;
}

function getWeaponDamageType(def: any) {
  // 형태 1) definition.damageType
  if (def?.damageType) return def.damageType;

  // 형태 2) damage.damageType
  const dmg = getWeaponDamage(def);
  if (dmg?.damageType) return dmg.damageType;

  // 형태 3) weaponBehaviors[0].damageType
  const wb0 = Array.isArray(def?.weaponBehaviors) ? def.weaponBehaviors[0] : null;
  if (wb0?.damageType) return wb0.damageType;

  return "";
}

function getWeaponProperties(def: any): string[] {
  // DDB에서 properties가 다양한 형태로 올 수 있어서 방어적으로
  const props: string[] = [];

  const raw = def?.properties ?? def?.weaponProperties ?? def?.propertyIds ?? null;

  if (Array.isArray(raw)) {
    for (const p of raw) {
      if (typeof p === "string") props.push(p.toLowerCase());
      else if (p?.name) props.push(String(p.name).toLowerCase());
      else if (p?.type) props.push(String(p.type).toLowerCase());
    }
  }

  // weaponBehaviors에 flags가 있는 경우도 있음
  const wb0 = Array.isArray(def?.weaponBehaviors) ? def.weaponBehaviors[0] : null;
  if (wb0?.properties && Array.isArray(wb0.properties)) {
    for (const p of wb0.properties) {
      if (typeof p === "string") props.push(p.toLowerCase());
      else if (p?.name) props.push(String(p.name).toLowerCase());
    }
  }

  // 중복 제거
  return Array.from(new Set(props));
}

function propsToKo(props: string[]) {
  const ko = props
    .map((p) => WEAPON_PROP_KO[p] ?? "")
    .filter(Boolean);
  return ko;
}

function formatFeet(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n}피트`;
}

function getRangesKo(def: any) {
  // 케이스가 많아서 후보를 여럿 본다.
  const reach = def?.reach ?? def?.range?.reach ?? def?.weaponRange?.reach ?? null;
  const range = def?.range ?? def?.weaponRange ?? null;

  // 원거리(예: 80/320) 형태 후보
  const normal = range?.normal ?? range?.value ?? range?.range ?? null;
  const long = range?.long ?? range?.longRange ?? null;

  const out: string[] = [];
  if (reach) out.push(`도달거리 ${formatFeet(reach)}`);
  if (normal && long) out.push(`사거리 ${formatFeet(normal)}/${formatFeet(long)}`);
  else if (normal) out.push(`사거리 ${formatFeet(normal)}`);

  return out;
}

function inferAttackModeKo(props: string[], def: any) {
  if (props.includes("ammunition")) return "원거리";
  if (props.includes("thrown")) return "원거리(투척)";
  if (props.includes("reach")) return "근접(도달)";
  return "근접";
}


function bestAbilityForWeapon(props: string[], def: any, abilityMods: any) {
  // ranged / ammunition / finesse / thrown 등에 따라 DEX 쪽을 우선 고려
  const isFinesse = props.includes("finesse");
  const isAmmunition = props.includes("ammunition");
  const isThrown = props.includes("thrown");

  // 간단 휴리스틱:
  // - 탄약/원거리 느낌이면 DEX
  // - 기교면 STR/DEX 중 높은 것
  // - 그 외는 STR
  if (isAmmunition) return { key: "dex", mod: Number(abilityMods.dex ?? 0) };

  if (isFinesse) {
    const str = Number(abilityMods.str ?? 0);
    const dex = Number(abilityMods.dex ?? 0);
    return dex >= str ? { key: "dex", mod: dex } : { key: "str", mod: str };
  }

  if (isThrown) {
    // 투척 무기는 보통 STR이지만, 기교가 같이 있으면 위에서 처리됨
    return { key: "str", mod: Number(abilityMods.str ?? 0) };
  }

  return { key: "str", mod: Number(abilityMods.str ?? 0) };
}

function getMagicBonus(item: any, def: any) {
  // +1 무기 같은 케이스에서 보너스가 다양한 곳에 존재할 수 있음
  // 우리가 확실히 잡을 수 있는 필드들만 우선 사용(없으면 0)
  const b1 = Number(item?.magicBonus ?? 0);
  const b2 = Number(def?.magicBonus ?? 0);
  return b1 || b2 || 0;
}

export function extractAttacks(ddb: any, base?: { abilityMods: any; proficiencyBonus: number }): NormalizedAttack[] {
  // 1) actions에서 먼저 시도
  const fromActions = extractAttacksFromActions(ddb);
  if (fromActions.length > 0) return fromActions;

  // 2) inventory 기반으로 생성
  const inv = Array.isArray(ddb?.inventory) ? ddb.inventory : [];
  const abilityMods = base?.abilityMods ?? {};
  const pb = Number(base?.proficiencyBonus ?? 2);

  const out: NormalizedAttack[] = [];

  for (const item of inv) {
    const def = getItemDef(item);
    if (!def) continue;
    if (!isWeaponItem(item)) continue;

    // 장착/소지 여부: 필드가 있으면 고려, 없으면 일단 포함
    const equipped = item?.equipped ?? item?.isEquipped ?? true;
    if (equipped === false) continue;

    const name = String(item?.name ?? def?.name ?? "").trim();
    if (!name) continue;

    const props = getWeaponProperties(def);
    const ability = bestAbilityForWeapon(props, def, abilityMods);

    // 숙련 여부: DDB는 item.isProficient 같은 필드가 있을 때가 있음
    // 없으면 일단 "숙련 가정"이 UX적으로 더 낫다(롤20급 목표)
    const isProficient =
      item?.isProficient != null ? !!item.isProficient : true;

    const magicBonus = getMagicBonus(item, def);

    const attackBonus = ability.mod + (isProficient ? pb : 0) + magicBonus;

    // 피해 주사위
    const dmg = getWeaponDamage(def);
    let diceCount = Number(dmg?.diceCount ?? 0);
    let diceValue = Number(dmg?.diceValue ?? 0);

    // damage가 없으면 스킵
    if (!diceCount || !diceValue) continue;

    const damageType = toKoDamageType(getWeaponDamageType(def));

    // 피해 = 주사위 + 능력수정 + 마법보너스(대부분)
    const fixed = ability.mod + magicBonus;
    const damage = `${diceCount}d${diceValue}${fixed ? (fixed > 0 ? `+${fixed}` : `${fixed}`) : ""}`;

    // 메모: 속성들 KR
	const modeKo = inferAttackModeKo(props, def);
	const rangesKo = getRangesKo(def);
	const propsKo = propsToKo(props);
	const notesKo = [modeKo, ...rangesKo, ...propsKo].filter(Boolean).join(", ");
    
    out.push({
      name,
      attackBonus,
      damage,
      damageType,
      notes: notesKo,
    });
  }

  // 중복 제거
  const uniq = new Map<string, NormalizedAttack>();
  for (const a of out) {
    const key = `${a.name}|${a.attackBonus}|${a.damage}|${a.damageType}`;
    if (!uniq.has(key)) uniq.set(key, a);
  }
  return Array.from(uniq.values());
}

export function buildAttackCommands(attacks: NormalizedAttack[]) {
  return attacks
    .map((atk) => {
      const hit = `1d20+${atk.attackBonus} ▼ 명중: ${atk.name}`;

      const dmg = atk.damage
        ? `${atk.damage} ▼ 피해: ${atk.name} (${atk.damageType || "피해"})`
        : `// 피해 정보 없음`;

      const memo = atk.notes ? `// 메모: ${atk.notes}` : "";

      return `// [공격] ${atk.name}\n${hit}\n${dmg}\n${memo}`.trim();
    })
    .join("\n\n");
}

function signed(n: number): string {
  const v = Math.trunc(n);
  return v >= 0 ? `+${v}` : `${v}`;
}

// 목록용: "[무기 공격]" 아래에 이름/명중/피해를 줄바꿈으로 나열
// 예)
// [무기 공격]
// 롱소드 (명중 +7, 피해 1d8+4 참격)

type AttackListMeta = {
  proficiencyBonus?: number;
  strMod?: number;
  dexMod?: number;
  isMonk?: boolean;
  monkLevel?: number;
  attackAbility?: "str" | "dex";
};

function _normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function _hasUnarmed(attacks: Array<{ name?: string }>): boolean {
  return attacks.some((a) => {
    const n = _normalizeName(String(a?.name ?? ""));
    return n === "unarmed strike" || n.includes("unarmed") || n === "비무장 타격" || n.includes("비무장");
  });
}

function _monkMartialArtsDie(level: number): string {
  if (level >= 17) return "1d10";
  if (level >= 11) return "1d8";
  if (level >= 5) return "1d6";
  return "1d4";
}

function _fmtBonus(n: number): string {
  const v = Math.trunc(n);
  if (!Number.isFinite(v) || v === 0) return "";
  return v > 0 ? `+${v}` : `${v}`;
}

function ensureUnarmedStrike(attacks: NormalizedAttack[], meta?: AttackListMeta): NormalizedAttack[] {
  const out = Array.isArray(attacks) ? [...attacks] : [];
  if (_hasUnarmed(out as any)) return out;

  const pb = typeof meta?.proficiencyBonus === "number" && Number.isFinite(meta.proficiencyBonus) ? meta.proficiencyBonus : 0;
  const strMod = typeof meta?.strMod === "number" && Number.isFinite(meta.strMod) ? meta.strMod : 0;
  const dexMod = typeof meta?.dexMod === "number" && Number.isFinite(meta.dexMod) ? meta.dexMod : 0;

  const ability = meta?.attackAbility ?? (meta?.isMonk ? "dex" : "str");
  const atkMod = ability === "dex" ? dexMod : strMod;

  const dmgDice = meta?.isMonk && typeof meta?.monkLevel === "number" && Number.isFinite(meta.monkLevel)
    ? _monkMartialArtsDie(Math.trunc(meta.monkLevel))
    : "1";

  // 피해식 문자열은 기존 출력 포맷(예: 1d4+3)과 맞추기 위해 여기서 조합
  const dmgExpr = dmgDice + _fmtBonus(atkMod);

  const synthetic: NormalizedAttack = {
    name: "Unarmed Strike",
    attackBonus: pb + atkMod,
    damage: dmgExpr,
    damageType: "타격",
	notes: "", // 👈 이 줄을 추가해주세요! (빈 문자열)
  };

  out.push(synthetic);
  return out;
}

export function buildAttackListKo(attacks: NormalizedAttack[], meta?: AttackListMeta): string {
  const base = Array.isArray(attacks) ? attacks : [];
  const finalAttacks = ensureUnarmedStrike(base, meta);
  if (finalAttacks.length === 0) return "";

  const lines: string[] = [];
  lines.push("[무기 공격]");


  for (const atk of finalAttacks) {
    const name = String(atk?.name ?? "").trim();
    if (!name) continue;

    const atkBonus =
      typeof atk?.attackBonus === "number" && Number.isFinite(atk.attackBonus)
        ? _fmtBonus(atk.attackBonus)
        : "";

    // 1) 공격 굴림
    if (atkBonus) lines.push(`1d20${atkBonus} ${name}`);
    else lines.push(`1d20 ${name}`); // 보너스가 없으면 공백 유지(가독)

    // 2) 피해 굴림
    const dmg = String(atk?.damage ?? "").trim();
    if (dmg) {
      const dmgType = String(atk?.damageType ?? "").trim();
      const typeText = dmgType ? ` ${dmgType} 대미지` : " 대미지";
      lines.push(`${dmg} ${name}${typeText}`);
    }
  }

  return lines.join("\n").trim();

}

