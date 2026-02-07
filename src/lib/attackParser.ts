// src/lib/attackParser.ts
export type ParsedAttack = {
  name: string;
  atkBonus: string; // e.g. "+5", "+0", "-1"
  damageDice: string | null; // e.g. "1d8+3"
  damageTypeEn: string | null; // e.g. "slashing"
  damageTypeKo: string | null; // e.g. "참격"
  traitsKo: string[]; // e.g. ["근접", "도달거리 5피트", "원거리 120피트"]
  notesRaw: string; // leftover notes
  confidence: number; // 0~1
};

const DAMAGE_TYPE_MAP: Record<string, string> = {
  acid: "산성",
  bludgeoning: "타격",
  cold: "냉기",
  fire: "화염",
  force: "역장",
  lightning: "번개",
  necrotic: "사령",
  piercing: "관통",
  poison: "독",
  psychic: "정신",
  radiant: "광휘",
  slashing: "참격",
  thunder: "천둥",
};

const TRAIT_MAP: Record<string, string> = {
  melee: "근접",
  ranged: "원거리",
  reach: "도달거리",
};

const DAMAGE_TYPES = Object.keys(DAMAGE_TYPE_MAP);

function normalizeSpaces(s: string) {
  return s.replace(/\s+/g, " ").trim();
}

function isJunkLine(line: string) {
  const t = line.trim();
  if (!t) return true;
  if (t.length <= 2) return true;
  const upper = t.toUpperCase();
  if (upper.includes("WEAPON ATTACKS")) return true;
  if (upper.includes("CANTRIPS")) return true;
  // 대문자/기호 위주의 헤더 제거(대충)
  const alphaCount = (t.match(/[A-Za-z]/g) || []).length;
  const digitCount = (t.match(/[0-9]/g) || []).length;
  if (alphaCount > 0 && digitCount === 0 && t.length > 20 && upper === t) return true;
  return false;
}

// "+ 0Bludgeoning" 같은 케이스를 "+0 Bludgeoning"으로
function normalizeAtkToken(s: string) {
  // "+ 0Bludgeoning" -> "+0 Bludgeoning"
  return s.replace(/([+-])\s*(\d+)([A-Za-z])/g, "$1$2 $3");
}

// ft / feet 정규화(번역은 나중)
function normalizeFeetToken(s: string) {
  return s.replace(/\b(\d+)\s*(ft\.?|feet)\b/gi, "$1 ft");
}

// OCR이 d를 6으로 잘못 읽는 케이스 복구: "166-1" -> "1d6+1"
function fixBrokenDiceToken(s: string) {
  // 166-1, 268+4 같은 패턴 복원
  // 규칙: (\d)6(\d)([+-]\d) -> \1d\2\3  (단, -는 +로 오인 많아서 그대로 둠)
  // 추가로 1d6-1처럼 나오도록.
  return s.replace(
  /\b(\d)6(\d)\s*([+-])\s*(\d+)\b/g,
  (_m, a, b, sign, num) => {
    // OCR에서 +를 -로 읽는 경우가 많아서,
    // 이 패턴( d가 6으로 깨진 형태 )에서는 +로 보정
    const fixedSign = "+";
    return `${a}d${b}${fixedSign}${num}`;
  }
);

}

// 매우 단순한 편집거리(Levenshtein). 타입 교정용.
function levenshtein(a: string, b: string) {
  const s = a.toLowerCase();
  const t = b.toLowerCase();
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function correctDamageType(word: string): string | null {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return null;
  if (DAMAGE_TYPE_MAP[w]) return w;

  // OCR 오타 교정: 가장 가까운 타입을 거리<=2면 채택
  let best: { k: string; d: number } | null = null;
  for (const k of DAMAGE_TYPES) {
    const d = levenshtein(w, k);
    if (!best || d < best.d) best = { k, d };
  }
  if (best && best.d <= 2) return best.k;
  return null;
}

function extractDice(s: string): { dice: string | null; rest: string } {
  // 1d8, 1d8+3, 2d6 + 4 형태
  const re = /\b\d+d\d+(?:\s*[+-]\s*\d+)?\b/i;
  const m = s.match(re);
  if (!m) return { dice: null, rest: s.trim() };

  const diceRaw = m[0].replace(/\s+/g, "");
  const before = s.slice(0, m.index ?? 0);
  const after = s.slice((m.index ?? 0) + m[0].length);
  const rest = `${before} ${after}`.trim();
  return { dice: diceRaw, rest };
}

function extractTraitsAndNotes(s: string): { traitsKo: string[]; notes: string } {
  let text = s;

  // reach 5 ft / ranged 120 ft 등
  const traits: string[] = [];

  // reach N ft
  text = text.replace(/\breach\s+(\d+)\s*ft\b/gi, (_m, n) => {
    traits.push(`도달거리 ${n}피트`);
    return " ";
  });

  // ranged N ft (가끔 단일 range만)
  text = text.replace(/\branged\s+(\d+)\s*ft\b/gi, (_m, n) => {
    traits.push(`원거리 ${n}피트`);
    return " ";
  });

  // melee / ranged 단독 키워드
  for (const [en, ko] of Object.entries(TRAIT_MAP)) {
    const re = new RegExp(`\\b${en}\\b`, "gi");
    if (re.test(text)) {
      traits.push(ko);
      text = text.replace(re, " ");
    }
  }

  // 남은 ft 표기: "120 ft" -> "120피트"
  text = text.replace(/\b(\d+)\s*ft\b/gi, "$1피트");

  return { traitsKo: Array.from(new Set(traits)), notes: normalizeSpaces(text) };
}

export function parseAttacksFromOcr(ocrText: string): ParsedAttack[] {
  // 1) 라인 분해 & 전처리
  const rawLines = ocrText.split(/\r?\n/);
  const lines = rawLines
    .map((l) => normalizeSpaces(l))
    .map((l) => normalizeAtkToken(l))
    .map((l) => normalizeFeetToken(l))
    .filter((l) => !isJunkLine(l));

  // 2) 레코드 버퍼로 합치기: "+n"과 dice가 나오면 레코드 완성
  const records: string[] = [];
  let buf = "";

  const hasAtk = (s: string) => /[+-]\s*\d{1,2}\b/.test(s);
  const hasDice = (s: string) => /\b\d+d\d+(?:\s*[+-]\s*\d+)?\b/i.test(s) || /\b(\d)6(\d)\s*[+-]\s*\d+\b/.test(s);

  for (const line of lines) {
    const candidate = buf ? `${buf} ${line}` : line;
    buf = normalizeSpaces(candidate);

    // dice 깨짐 복구는 버퍼 완성 직전에 적용
    const bufFixed = fixBrokenDiceToken(buf);

    if (hasAtk(bufFixed) && hasDice(bufFixed)) {
      records.push(bufFixed);
      buf = "";
    }
  }
  if (buf.trim()) {
    // 남은 버퍼도 일단 기록(주사위 없는 공격도 있을 수 있음: Unarmed 등)
    records.push(fixBrokenDiceToken(buf.trim()));
  }

  // 3) 레코드 파싱
  const attacks: ParsedAttack[] = [];

  for (const rec0 of records) {
    const rec = normalizeSpaces(rec0);

    // name + atk + tail 분리
    // 첫 번째 "+n" / "-n" 찾기
    const atkMatch = rec.match(/([+-])\s*(\d{1,2})\b/);
    if (!atkMatch || atkMatch.index == null) continue;

    const atkBonus = `${atkMatch[1]}${atkMatch[2]}`;
    const name = normalizeSpaces(rec.slice(0, atkMatch.index));
    let tail = normalizeSpaces(rec.slice(atkMatch.index + atkMatch[0].length));

    if (!name) continue;

    // tail에서 dice 추출(없으면 null)
    tail = fixBrokenDiceToken(tail);
    const { dice, rest: restAfterDice } = extractDice(tail);

    // 피해 타입 찾기: restAfterDice에서 첫 단어를 우선, 아니면 전체에서 탐색
    const words = restAfterDice.split(" ").filter(Boolean);

    let damageTypeEn: string | null = null;
    if (words.length) {
      damageTypeEn = correctDamageType(words[0]) ?? null;
    }
    if (!damageTypeEn) {
      // 전체에서라도 찾아보기
      for (const w of words) {
        const c = correctDamageType(w);
        if (c) {
          damageTypeEn = c;
          break;
        }
      }
    }

    const damageTypeKo = damageTypeEn ? DAMAGE_TYPE_MAP[damageTypeEn] : null;

    // 타입 단어 제거해서 notes 정리
    let notesRaw = restAfterDice;
    if (damageTypeEn) {
      const re = new RegExp(`\\b${damageTypeEn}\\b`, "i");
      notesRaw = normalizeSpaces(notesRaw.replace(re, " "));
    }

    // traits + notes 번역/정리
    const { traitsKo, notes } = extractTraitsAndNotes(notesRaw);

    // confidence 계산
    let conf = 0;
    if (name) conf += 0.35;
    if (atkBonus) conf += 0.25;
    if (dice) conf += 0.25;
    if (damageTypeEn) conf += 0.15;

    attacks.push({
      name,
      atkBonus,
      damageDice: dice,
      damageTypeEn,
      damageTypeKo,
      traitsKo,
      notesRaw: notes,
      confidence: Math.min(1, Math.max(0, conf)),
    });
  }

  // 중복 제거(이상하게 같은 공격이 2번 잡히는 경우)
  const seen = new Set<string>();
  const uniq = attacks.filter((a) => {
    const key = `${a.name}|${a.atkBonus}|${a.damageDice ?? ""}|${a.damageTypeKo ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniq;
}

export function buildAttackCommandsKo(attacks: ParsedAttack[]): string {
  const lines: string[] = [];

  for (const a of attacks) {
    const traits = a.traitsKo.length ? ` (${a.traitsKo.join(", ")})` : "";
    const warn = a.confidence < 0.7 ? " ⚠" : "";

    lines.push(`// [공격] ${a.name}${traits}${warn}`);
    lines.push(`1d20${a.atkBonus} ▼ 명중: ${a.name}`);

    // 피해가 없으면 기본값 1
    const dice = a.damageDice ?? "1";
    const typePart = a.damageTypeKo ? ` (${a.damageTypeKo})` : "";
    lines.push(`${dice} ▼ 피해: ${a.name}${typePart}`);

    // notes 정리: 피해 타입 단어(오타 포함) 제거 + 공백 정리
    const cleanedNotes = (a.notesRaw || "")
      .replace(
        /\b(budgeoning|bludgeoning|slashing|piercing|cold|fire|acid|force|lightning|necrotic|poison|psychic|radiant|thunder)\b/gi,
        ""
      )
      .replace(/\s+/g, " ")
      .replace(/^,|,$/g, "")
      .trim();

    if (cleanedNotes) lines.push(`// 메모: ${cleanedNotes}`);

    lines.push(""); // 빈 줄
  }

  return lines.join("\n").trim();
}

/**
 * ✅ OCR 결과를 코코포리아에 "목록" 형태로 넣고 싶을 때.
 * - //, - 제거
 */
export function buildAttackListKo(attacks: ParsedAttack[]): string {
  const names = attacks
    .map((a) => String(a?.name ?? "").trim())
    .filter(Boolean);

  const uniq = Array.from(new Set(names));
  if (uniq.length === 0) return "";

  return ["[무기 공격]", ...uniq].join("\n");
}
