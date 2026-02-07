// src/lib/ccfolia.ts
import {
  ABILITIES,
  ABILITY_LABEL_KO,
  SKILL_LABEL_KO,
  NormalizedBasic,
} from "./ddbNormalize";

export function buildCcfoliaCharacterJson(args: {
  base: NormalizedBasic;
  playerName?: string;
  attackCommandsKo?: string;
}) {
  const { base, playerName, attackCommandsKo } = args;

  // ✅ 1. Status (바/게이지) 설정
  // HP, 임시 HP, AC를 여기에 정의합니다.
  const status = [
    { label: "HP", value: String(base.hpCurrent), max: String(base.hpMax) },
    { label: "임시 HP", value: "0", max: "100" }, // 임시HP는 보통 0에서 시작하므로 고정
    { label: "AC", value: String(base.ac), max: String(base.ac) }, // AC 추가 (Max도 같게 설정하여 꽉 찬 바로 표시)
  ];

  const params: { label: string; value: string }[] = [];

  // ✅ 2. Params (텍스트 파라미터) 설정
  // AC는 status로 이동했으므로 여기서 제외합니다.
  params.push({ label: "레벨", value: String(base.level) });
  params.push({ label: "숙련보너스", value: `+${base.proficiencyBonus}` });
  // params.push({ label: "AC", value: String(base.ac) }); // <-- 삭제됨
  params.push({ label: "이동속도", value: `${base.speedFt}피트` });
  params.push({ label: "이니셔티브", value: base.initiative >= 0 ? `+${base.initiative}` : String(base.initiative) });

  // 능력치 / 수정치
  for (const k of ABILITIES) {
    params.push({ label: `${ABILITY_LABEL_KO[k]} 현재값`, value: String(base.abilityScores[k]) });
    const m = base.abilityMods[k];
    params.push({ label: `${ABILITY_LABEL_KO[k]} 수정`, value: m >= 0 ? `+${m}` : String(m) });
  }

  // 내성(Save)
  for (const k of ABILITIES) {
    const v = base.saveMods[k];
    params.push({ label: `${ABILITY_LABEL_KO[k]} 세이브`, value: v >= 0 ? `+${v}` : String(v) });
  }

  // 기술(Skill)
  for (const [skillKey, ko] of Object.entries(SKILL_LABEL_KO)) {
    const v = base.skillMods[skillKey] ?? 0;
    params.push({ label: ko, value: v >= 0 ? `+${v}` : String(v) });
  }

  const memo = [
    `PC: ${base.name}`,
    playerName ? `PL: ${playerName}` : "",
    `레벨: ${base.level}`,
    attackCommandsKo ? "\n" + attackCommandsKo : "",
  ].filter(Boolean).join("\n");

  return {
    kind: "character",
    data: {
      name: base.name,
      memo,
      initiative: base.initiative,

      status, // 위에서 정의한 status 배열 사용
      params,

      active: "true",
      secret: "false",
      invisible: "false",
      hideStatus: "false",

      commands: "", // 명령어를 메모장이 아닌 chat palette에 넣고 싶으면 여기에 string 연결
    },
  };
}

export function stringifyCcfoliaJson(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}