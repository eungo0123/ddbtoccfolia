// src/lib/ddbAc.ts

function getDef(item: any) {
  return item?.definition ?? item?.itemDefinition ?? item?.definitionData ?? null;
}

function isEquipped(item: any) {
  const v = item?.equipped ?? item?.isEquipped ?? item?.isEquippedItem;
  return v == null ? true : !!v;
}

function isArmorLike(def: any) {
  const ac = def?.armorClass ?? def?.armorClassValue ?? def?.baseArmorClass ?? null;
  return ac != null;
}

function isShield(def: any) {
  const t = String(def?.armorType ?? def?.armorCategory ?? def?.subType ?? def?.type ?? "").toLowerCase();
  const name = String(def?.name ?? "").toLowerCase();
  return t.includes("shield") || name.includes("shield") || name.includes("방패");
}

function getArmorType(def: any): "light" | "medium" | "heavy" | "shield" | "none" {
  if (isShield(def)) return "shield";

  const typeId = Number(def?.armorTypeId);
  if (typeId === 1) return "light";
  if (typeId === 2) return "medium";
  if (typeId === 3) return "heavy";

  const t = String(def?.type ?? "").toLowerCase();
  const sub = String(def?.subType ?? "").toLowerCase();

  if (t.includes("heavy") || sub.includes("heavy")) return "heavy";
  if (t.includes("medium") || sub.includes("medium")) return "medium";
  if (t.includes("light") || sub.includes("light")) return "light";

  return "none";
}

function readArmorBase(def: any): number | null {
  const v = def?.armorClass ?? def?.armorClassValue ?? def?.baseArmorClass ?? null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * AC 계산 로직
 * ✅ [수정] dexMod를 인자로 받아서 사용합니다. (DDB raw 데이터에서 직접 계산 X)
 */
export function calculateArmorClass(ddb: any, dexMod: number): number {
  const inv = Array.isArray(ddb?.inventory) ? ddb.inventory : [];
  let armorDef: any = null;
  let shieldDef: any = null;

  // 장착 중인 갑옷과 방패 찾기
  for (const it of inv) {
    if (!isEquipped(it)) continue;
    const def = getDef(it);
    if (!def) continue;
    if (!isArmorLike(def)) continue;

    if (isShield(def)) {
      shieldDef = shieldDef ?? def;
    } else {
      armorDef = armorDef ?? def;
    }
  }

  let ac = 0;

  if (armorDef) {
    const base = readArmorBase(armorDef) ?? 10;
    const type = getArmorType(armorDef);

    if (type === "heavy") {
      // 중갑: 민첩 보너스 없음
      ac = base;
    } else if (type === "medium") {
      // 평갑: 민첩 보너스 최대 +2
      ac = base + Math.min(dexMod, 2);
    } else {
      // 경갑(로그 등) 또는 기타: 민첩 보너스 다 받음
      ac = base + dexMod;
    }
  } else {
    // 갑옷 없음: 10 + 민첩
    // (Unarmored Defense 등은 여기서 처리되지 않지만 기본값으로 안전)
    ac = 10 + dexMod;
  }

  // 방패 보너스 추가
  if (shieldDef) {
    const bonusRaw = shieldDef?.armorClass ?? shieldDef?.armorClassValue ?? 2;
    const bonus = Number(bonusRaw);
    ac += Number.isFinite(bonus) ? bonus : 2;
  }

  return Math.max(1, Math.floor(ac));
}