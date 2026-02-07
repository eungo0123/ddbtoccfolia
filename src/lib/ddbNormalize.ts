// src/lib/ddbNormalize.ts

export function normalizeBasic(ddb: any): NormalizedBasic {
  const name = String(ddb?.name ?? "").trim() || "Unnamed";
  const level = totalLevel(ddb) || 1;

  // PB: modifiers에 있으면 쓰고, 없으면 레벨 계산
  const mods = getAllModifiers(ddb);
  const pbFromMods =
    mods
      .filter((m: any) => m?.type === "proficiency-bonus")
      .reduce((sum: number, m: any) => sum + Number(m?.value ?? 0), 0) || 0;

  const proficiencyBonus = pbFromMods || pbFromLevel(level);

  const abilityScores = getAbilityScores(ddb);
  const abilityMods: Record<AbilityKey, number> = {
    str: mod(abilityScores.str),
    dex: mod(abilityScores.dex),
    con: mod(abilityScores.con),
    int: mod(abilityScores.int),
    wis: mod(abilityScores.wis),
    cha: mod(abilityScores.cha),
  };

  const { max: hpMax, cur: hpCurrent } = getHp(ddb);
  const ac = getAc(ddb);
  const speedFt = getSpeedFt(ddb);
  const initiative = abilityMods.dex;

  const saveMods: Record<AbilityKey, number> = { ...abilityMods };

  const skillMods: Record<string, number> = {};
  for (const [skill, ab] of Object.entries(SKILL_ABILITY)) {
    skillMods[skill] = abilityMods[ab];
  }

  // ✅ [여기가 핵심!] 이 부분이 빠져있어서 값이 0으로 나오고 있었습니다.
  // 아이템 보너스 계산 함수 호출
  const { spellAttackBonusBonus, spellSaveDcBonus } = getSpellBonusesFromModifiers(ddb);

  return {
    name,
    level,
    proficiencyBonus,
    // ✅ [추가] 리턴값에도 꼭 넣어줘야 합니다.
    spellAttackBonusBonus,
    spellSaveDcBonus,

    hpMax,
    hpCurrent,
    ac,
    speedFt,
    initiative,
    abilityScores,
    abilityMods,
    saveMods,
    skillMods,
  };
}