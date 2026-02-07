// src/lib/ccfolia.ts
import {
  ABILITIES,
  ABILITY_LABEL_KO,
  SKILL_LABEL_KO,
  NormalizedBasic,
} from "./ddbNormalize";

export function buildCcfoliaCharacterJson(args: {
  base: NormalizedBasic;
  attackList: string;
  spellList: string;
  featureList: string;
  itemList: string; // 장비 리스트도 있다면 추가
}) {
  const { base, attackList, spellList, featureList, itemList } = args;

  // 1. 상태 바 (HP, AC)
  const status = [
    { label: "HP", value: String(base.hpCurrent), max: String(base.hpMax) },
    { label: "AC", value: String(base.ac), max: String(base.ac) }, // AC도 바(Bar)로 보고 싶으면 max 추가
  ];

  // 2. 파라미터 (능력치 등)
  const params = [
    { label: "이니셔티브", value: String(base.initiative) },
    { label: "이동속도", value: String(base.speedFt) },
    { label: "숙련보너스", value: String(base.proficiencyBonus) },
    // 필요하면 근력, 민첩 등도 여기에 추가 가능
  ];
  
  // ✅ [수정] 메모에 멀티클래스 정보 추가
  // 예: [Class] Fighter 3 / Wizard 2
  const memoLines = [
    `[Class] ${base.classesStr}`,
    `[Level] ${base.level}`,
    "", // 빈 줄
    featureList,
    itemList // 장비 리스트가 있다면
  ].filter(Boolean).join("\n");


  // 3. 채팅 팔레트 (명령어)
  // ... (기존 팔레트 생성 로직 그대로) ...
  // 여기는 기존 코드와 같으니 생략하거나 유지하시면 됩니다.
  // 다만 예시를 위해 앞부분만 보여드리면:
  
  const commands: string[] = [];
  commands.push(`1d20+${base.initiative} 이니셔티브`);
  commands.push("");
  // ... (능력치, 스킬, 공격, 주문 추가 로직) ...
  if (attackList) commands.push(attackList);
  if (spellList) commands.push(spellList);

  return {
    kind: "character",
    data: {
      name: base.name,
      memo: memoLines, // ✅ 여기에 수정된 메모 삽입
      initiative: base.initiative,
      status,
      params,
      active: "true",
      secret: "false",
      invisible: "false",
      hideStatus: "false",
      commands: commands.join("\n"),
    },
  };
}

export function stringifyCcfoliaJson(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}