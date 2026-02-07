// src/lib/ccfolia.ts
import { NormalizedBasic, SKILL_LABEL_KO } from "./ddbNormalize";

export function buildCcfoliaCharacterJson(args: {
  base: NormalizedBasic;
  attackList?: string;
  spellList?: string;
  featureList?: string;
  itemList?: string;
  customMemo?: string;
  noCommands?: boolean; 
}) {
  const { base, attackList, spellList, featureList, itemList, customMemo, noCommands } = args;

  // 1. 상태 바 (HP, AC)
  const status = [
    { label: "HP", value: String(base.hpCurrent), max: String(base.hpMax) },
    { label: "AC", value: String(base.ac), max: String(base.ac) },
  ];

  // 2. 파라미터 (능력치, 스킬, 기타 등등)
  const params: { label: string; value: string }[] = [];

  // (1) 기본 정보
  params.push({ label: "이니셔티브", value: String(base.initiative) });
  params.push({ label: "이동속도", value: String(base.speedFt) });
  params.push({ label: "숙련보너스", value: String(base.proficiencyBonus) });

  // (2) 능력치 수정치 (STR, DEX ...) - 매크로 변수로 쓰기 좋게 영문 사용
  // 필요하다면 "근력" 등으로 바꿔도 되지만, 보통 {STR} 변수를 많이 씁니다.
  const stats = ["str", "dex", "con", "int", "wis", "cha"] as const;
  for (const s of stats) {
    const mod = base.abilityMods[s];
    params.push({ label: s.toUpperCase(), value: String(mod) });
  }

  // (3) 스킬 (한글 라벨)
  // 값이 0이 아닌 것만 넣거나, 전부 넣을 수 있습니다. 여기선 전부 넣습니다.
  for (const [engKey, val] of Object.entries(base.skillMods)) {
    // 공백 제거 및 소문자화 키 매칭 (SKILL_LABEL_KO 키와 맞춤)
    // ddbNormalize의 SKILL_LABEL_KO 키는 "sleightofhand" 처럼 공백없음/소문자
    const mapKey = engKey.toLowerCase().replace(/\s+/g, "");
    const koLabel = SKILL_LABEL_KO[mapKey] ?? engKey;
    
    params.push({ label: koLabel, value: String(val) });
  }

  // 3. 메모 생성
  let memoLines = "";
  if (customMemo) {
    memoLines = customMemo;
  } else {
    memoLines = [
      `[Class] ${base.classesStr}`,
      `[Level] ${base.level}`,
      "",
      featureList,
      itemList
    ].filter(Boolean).join("\n");
  }

  // 4. 명령어 생성
  let commandsStr = "";
  if (!noCommands) {
    const commands: string[] = [];
    commands.push(`1d20+${base.initiative} 이니셔티브`);
    commands.push("");
    if (attackList) commands.push(attackList);
    if (spellList) commands.push(spellList);
    commandsStr = commands.join("\n");
  }

  return {
    kind: "character",
    data: {
      name: base.name,
      memo: memoLines,
      initiative: base.initiative,
      status,
      params, // ✅ 능력치/스킬 포함됨
      active: "true",
      secret: "false",
      invisible: "false",
      hideStatus: "false",
      commands: commandsStr,
    },
  };
}

export function stringifyCcfoliaJson(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}