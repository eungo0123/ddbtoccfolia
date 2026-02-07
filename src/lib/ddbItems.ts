// src/lib/ddbItems.ts

/**
 * 아이템 목록을 예쁘게 정리해서 문자열로 반환
 */
export function buildItemListKo(ddb: any): string {
  const lines: string[] = [];

  // 1. 소지금 (돈)
  const cp = ddb?.currencies?.cp ?? 0;
  const sp = ddb?.currencies?.sp ?? 0;
  const ep = ddb?.currencies?.ep ?? 0;
  const gp = ddb?.currencies?.gp ?? 0;
  const pp = ddb?.currencies?.pp ?? 0;

  if (cp || sp || ep || gp || pp) {
    const money: string[] = [];
    if (pp > 0) money.push(`${pp}pp`);
    if (gp > 0) money.push(`${gp}gp`);
    if (ep > 0) money.push(`${ep}ep`);
    if (sp > 0) money.push(`${sp}sp`);
    if (cp > 0) money.push(`${cp}cp`);
    
    lines.push(`[소지금]`);
    lines.push(money.join(" / "));
    lines.push("");
  }

  // 2. 인벤토리
  const inv = ddb?.inventory;
  if (!Array.isArray(inv) || inv.length === 0) {
    return lines.join("\n").trim();
  }

  const equipped: string[] = [];
  const carried: string[] = [];
  const attunement: string[] = []; // 조율된 아이템 강조

  for (const item of inv) {
    const def = item?.definition;
    const name = def?.name ?? item?.name ?? "Unknown";
    const qty = item?.quantity ?? 1;
    const isEquipped = item?.equipped ?? false;
    const isAttuned = item?.isAttuned ?? false;

    // 이름 포맷: "포션 (x5)"
    let str = name;
    if (qty > 1) str += ` (x${qty})`;

    // 조율 여부 표시
    if (isAttuned) str = `(A) ${str}`;

    if (isEquipped) {
      equipped.push(str);
    } else {
      carried.push(str);
    }
  }

  // 착용 장비 출력
  if (equipped.length > 0) {
    lines.push(`[착용 장비]`);
    lines.push(equipped.sort().join("\n"));
    lines.push("");
  }

  // 배낭/소지품 출력
  if (carried.length > 0) {
    lines.push(`[소지품]`);
    lines.push(carried.sort().join("\n"));
  }

  return lines.join("\n").trim();
}