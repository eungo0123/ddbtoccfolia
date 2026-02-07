// src/lib/coreParser.ts

export type CoreStats = {
  level?: string;
  ac?: string;
  hpValue?: string;
  hpMax?: string;
  speed?: string;

  str?: string; strMod?: string;
  dex?: string; dexMod?: string;
  con?: string; conMod?: string;
  int?: string; intMod?: string;
  wis?: string; wisMod?: string;
  cha?: string; chaMod?: string;

  initiative?: string;
};

function norm(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function normMod(x: string) {
  const t = (x || "").replace(/\s+/g, "").trim();
  if (!t) return "";
  if (t.startsWith("+") || t.startsWith("-")) return t;
  return `+${t}`;
}

export function parseCoreStatsFromOcr(textRaw: string): CoreStats {
  const text = norm(textRaw);
  const out: CoreStats = {};

  // Level
  const mLv =
    text.match(/\bLevel\s*(\d+)\b/i) ||
    text.match(/\bLv\.?\s*(\d+)\b/i);
  if (mLv) out.level = mLv[1];

  // AC
  const mAC =
    text.match(/\bArmor Class\s*(\d+)\b/i) ||
    text.match(/\bAC\s*(\d+)\b/i);
  if (mAC) out.ac = mAC[1];

  // HP
  const mHP = text.match(/\bHit Points?\s*(\d+)\s*\/\s*(\d+)\b/i);
  if (mHP) {
    out.hpValue = mHP[1];
    out.hpMax = mHP[2];
  } else {
    const mHP2 = text.match(/\bHit Points?\s*(\d+)\b/i);
    if (mHP2) {
      out.hpValue = mHP2[1];
      out.hpMax = mHP2[1];
    }
  }

  // Speed (ft는 피트로)
  const mSpd = text.match(/\bSpeed\s*(\d+)\s*(ft\.?|feet)?\b/i);
  if (mSpd) out.speed = `${mSpd[1]}피트`;

  // Initiative
  const mInit = text.match(/\bInitiative\s*([+-]?\s*\d+)\b/i);
  if (mInit) out.initiative = normMod(mInit[1]);

  // Ability scores: "STR 8 (-1)" / "Strength 8 (-1)" 형태
  function pickAbility(
    code: "str" | "dex" | "con" | "int" | "wis" | "cha",
    re: RegExp
  ) {
    const m = text.match(re);
    if (!m) return;
    const score = m[1];
    const mod = m[2];
    (out as any)[code] = score;
    (out as any)[`${code}Mod`] = normMod(mod);
  }

  pickAbility("str", /\b(?:STR|Strength)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);
  pickAbility("dex", /\b(?:DEX|Dexterity)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);
  pickAbility("con", /\b(?:CON|Constitution)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);
  pickAbility("int", /\b(?:INT|Intelligence)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);
  pickAbility("wis", /\b(?:WIS|Wisdom)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);
  pickAbility("cha", /\b(?:CHA|Charisma)\s*(\d+)\s*\(\s*([+-]?\s*\d+)\s*\)/i);

  return out;
}
