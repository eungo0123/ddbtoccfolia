// src/lib/ddbItems.ts

export function buildItemListKo(ddb: any): string {
  const lines: string[] = [];

  // 1. 소지금 (돈은 중요하니까 맨 위에!)
  const cur = ddb?.character?.currencies ?? ddb?.currencies;
  if (cur) {
    const moneyParts = [];
    if (cur.pp > 0) moneyParts.push(`${cur.pp}pp`);
    if (cur.gp > 0) moneyParts.push(`${cur.gp}gp`);
    if (cur.ep > 0) moneyParts.push(`${cur.ep}ep`);
    if (cur.sp > 0) moneyParts.push(`${cur.sp}sp`);
    if (cur.cp > 0) moneyParts.push(`${cur.cp}cp`);

    if (moneyParts.length > 0) {
      lines.push(`[소지금] ${moneyParts.join(" / ")}`);
      lines.push("");
    }
  }

  // 2. 아이템 목록 (중복 합치기 로직 적용)
  const rawInv = ddb?.character?.inventory ?? ddb?.inventory;
  
  if (Array.isArray(rawInv)) {
    // ✅ 이름으로 묶어서 관리할 장부 (Map)
    // 키: 아이템 이름 / 값: { 갯수, 장착여부 }
    const itemMap = new Map<string, { count: number; equipped: boolean }>();

    for (const item of rawInv) {
      const def = item?.definition;
      // 이름이 없으면 스킵
      if (!def || !def.name) continue;

      const name = def.name;
      
      // 수량 가져오기 (없으면 1개로 침)
      let qty = Number(item.quantity);
      if (isNaN(qty) || qty < 0) qty = 1;
      
      // 수량이 0인 아이템(삭제된 것 등)은 아예 무시
      if (qty === 0) continue;

      const isEquipped = item.equipped ?? false;

      // 🔥 핵심 로직: 장부에 이미 같은 이름이 있나?
      if (itemMap.has(name)) {
        // 있으면 -> 갯수 더하기!
        const existing = itemMap.get(name)!;
        existing.count += qty;
        
        // 둘 중 하나라도 장착 중이면 [E] 표시 유지
        if (isEquipped) existing.equipped = true;
      } else {
        // 없으면 -> 새로 등록
        itemMap.set(name, { count: qty, equipped: isEquipped });
      }
    }

    // 3. 이름순 정렬해서 출력하기
    // 가나다 순으로 정렬해야 찾기 편합니다.
    const sortedNames = Array.from(itemMap.keys()).sort();
    
    for (const name of sortedNames) {
      const info = itemMap.get(name)!;
      
      // 장착했으면 앞에 [E] 붙이기
      const equippedMark = info.equipped ? "[장비] " : ""; 
      
      // 갯수가 1개보다 많을 때만 (x5) 처럼 표시
      const qtyStr = info.count > 1 ? ` (x${info.count})` : "";
      
      lines.push(`${equippedMark}${name}${qtyStr}`);
    }
  }

  if (lines.length === 0) return "소지품 없음";

  return lines.join("\n");
}