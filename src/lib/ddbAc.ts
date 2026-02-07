// src/lib/ddbAc.ts
import { getAllModifiers } from "./ddbModifiers";

function abilityMod(score: number) {
  const n = Number(score ?? 10);
  return Math.floor((n - 10) / 2);
}

function getDef(item: any) {
  return item?.definition ?? item?.itemDefinition ?? item?.definitionData ?? null;
}

function isEquipped(item: any) {
  const v = item?.equipped ?? item?.isEquipped ?? item?.isEquippedItem;
  return v == null ? true : !!v;
}

function isArmorLike(def: any) {
  const ac =
    def?.armorClass ?? def?.armorClassValue ?? def?.baseArmorClass ?? null;
  return ac != null;
}

function isShield(def: any) {
  const t = String(def?.armorType ?? def?.armorCategory ?? def?.subType ?? "").toLowerCase();
  const name = String(def?.name ?? "").toLowerCase();
  return t.includes("shield") || name.includes("shield") || name.includes("buckler");
}

function readArmorBase(def: any): number | null {
  const v = def?.armorClass ?? def?.armorClassValue ?? def?.baseArmorClass ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 안전 AC 계산(우선순위):
 * 1) 갑옷 착용 시: armorBase + DEX(기본은 전부 허용)  ※ medium/heavy 캡은 나중에 확장
 * 2) 방패 착용 시: +2 (def값이 숫자로 있으면 그걸 사용)
 * 3) 둘 다 없으면: 10 + DEX
 * 4) modifiers의 "armor-class"는 일단 적용하지 않음(오작동 방지) — 필요하면 나중에 정확히 필터링
 */
export function calculateArmorClass(ddb: any): number {
  const dexScore = Number(ddb?.stats?.[1]?.value ?? 10);
  const dexMod = abilityMod(dexScore);

  const inv = Array.isArray(ddb?.inventory) ? ddb.inventory : [];
  let armorDef: any = null;
  let shieldDef: any = null;

  for (const it of inv) {
    if (!isEquipped(it)) continue;
    const def = getDef(it);
    if (!def) continue;
    if (!isArmorLike(def)) continue;

    if (isShield(def)) shieldDef = shieldDef ?? def;
    else armorDef = armorDef ?? def;
  }

  let ac = 10 + dexMod;

  if (armorDef) {
    const base = readArmorBase(armorDef);
    if (base != null) ac = base + dexMod;
  }

  if (shieldDef) {
    const bonusRaw = shieldDef?.armorClass ?? shieldDef?.armorClassValue ?? 2;
    const bonus = Number(bonusRaw);
    ac += Number.isFinite(bonus) ? bonus : 2;
  }

  // 혹시 계산이 이상하면 최소한 10+DEX로 안전하게
  if (!Number.isFinite(ac)) ac = 10 + dexMod;

  return Math.max(1, Math.floor(ac));
}
