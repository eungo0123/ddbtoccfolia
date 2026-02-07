// src/lib/ddbSpells.ts
import type { NormalizedBasic, AbilityKey } from "@/lib/ddbNormalize";

export type NormalizedSpellAction =
  | {
      kind: "spell_attack";
      name: string;
      toHitBonus: number;
      damage?: string; // "1d6"
      damageTypeKo?: string; // "관통" 등
      notes?: string;
      effect?: string; // (있으면 같이 표시)
    }
  | {
      kind: "spell_save";
      name: string;
      dc: number;
      saveAbilityKo?: string;
      damage?: string; // 저장 내성 주문도 피해가 있으면 표기
      damageTypeKo?: string;
      notes?: string;
      effect?: string;
    }
  | {
      kind: "spell_other";
      name: string;
      effect?: string; // ✅ 버프/유틸용 핵심
      notes?: string;
    };

const SAVE_KO: Record<string, string> = {
  str: "근력",
  dex: "민첩",
  con: "건강",
  int: "지능",
  wis: "지혜",
  cha: "매력",
};

function toKoDamageType(x: any): string | undefined {
  const s = String(x ?? "").toLowerCase();
  if (!s) return undefined;
  if (s.includes("slashing")) return "참격";
  if (s.includes("piercing")) return "관통";
  if (s.includes("bludgeoning")) return "타격";
  if (s.includes("cold")) return "냉기";
  if (s.includes("fire")) return "화염";
  if (s.includes("acid")) return "산성";
  if (s.includes("force")) return "역장";
  if (s.includes("lightning")) return "번개";
  if (s.includes("necrotic")) return "사령";
  if (s.includes("poison")) return "독";
  if (s.includes("psychic")) return "정신";
  if (s.includes("radiant")) return "광휘";
  if (s.includes("thunder")) return "천둥";
  return undefined;
}

function fmtFeet(v: any): string {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n}피트`;
}

// [object Object] 방지: 어떤 값이 와도 사람이 읽을 수 있게 문자열화
function fmtAny(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return `${v}피트`;
  if (typeof v === "boolean") return String(v);

  const unit = (v?.unit ?? v?.type ?? "").toString().toLowerCase();
  const value = v?.value ?? v?.amount ?? v?.distance ?? v?.range ?? v?.normal ?? null;
  const long = v?.long ?? v?.longRange ?? null;

  if (value != null && (unit.includes("foot") || unit.includes("feet"))) {
    if (long != null) return `${fmtFeet(value)}/${fmtFeet(long)}`;
    return fmtFeet(value);
  }
  if (typeof v?.description === "string") return v.description;
  if (typeof v?.label === "string") return v.label;

  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function stripHtml(s: any): string {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/p>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// "2d8 thunder damage", "takes 1d6 cold damage" 같은 문장에서 주사위/타입 추출
function pickDamageFromDescription(def: any, characterLevel: number) {
  const text = stripHtml(def?.description);

  // 가장 흔한 패턴들:
  // - "takes 2d8 thunder damage"
  // - "takes 1d6 cold damage"
  // - "takes 8d8 necrotic damage"
  // - "takes 2d10 radiant damage"
  const m =
    text.match(/(\d+d\d+)\s+([a-z]+)\s+damage/i) ||
    text.match(/takes\s+(\d+d\d+)\s+([a-z]+)\s+damage/i) ||
    text.match(/(\d+d\d+)\s+([a-z]+)\s+damage\s*/i);

  if (!m) return null;

  let dice = m[1];          // e.g. "1d6"
  const dmgTypeEn = m[2];   // e.g. "cold"

  // 캔트립이면 레벨에 따라 주사위 수 증가 (5/11/17)
  if (Number(def?.level) === 0) {
    dice = scaleCantripDice(dice, characterLevel);
  }

  const damageTypeKo = toKoDamageType(dmgTypeEn);
  return { dice, damageTypeKo };
}

function scaleCantripDice(dice: string, characterLevel: number): string {
  const m = String(dice).match(/^(\d+)d(\d+)$/i);
  if (!m) return dice;

  const n = Number(m[1]);
  const faces = Number(m[2]);

  const mult =
    characterLevel >= 17 ? 4 :
    characterLevel >= 11 ? 3 :
    characterLevel >= 5 ? 2 : 1;

  return `${n * mult}d${faces}`;
}


function fmtDurationKo(d: any): string {
  if (!d) return "";

  const t = String(d?.durationType ?? "").toLowerCase();
  if (t.includes("instant")) return "즉시";
  if (t.includes("special")) return "특수";

  // Concentration 타입은 buildNotes에서 "집중"으로 따로 표시하니까 여기서는 시간만
  const interval = Number(d?.durationInterval ?? 0);
  const unit = String(d?.durationUnit ?? "").toLowerCase();

  const unitKo =
    unit.includes("round") ? "라운드" :
    unit.includes("minute") ? "분" :
    unit.includes("hour") ? "시간" :
    unit.includes("day") ? "일" :
    unit ? unit : "";

  if (!interval || !unitKo) return t ? d?.durationType : "";
  return `${interval}${unitKo}`;
}

function fmtComponentsKo(c: any): string {
  if (!c) return "";

  // DDB는 [1,2,3] 형태가 흔함: 1=V, 2=S, 3=M
  if (Array.isArray(c)) {
    const hasV = c.includes(1);
    const hasS = c.includes(2);
    const hasM = c.includes(3);
    const out = [hasV ? "V" : "", hasS ? "S" : "", hasM ? "M" : ""]
      .filter(Boolean)
      .join("/");
    return out || "";
  }

  // 혹시 문자열로 오면 그대로
  if (typeof c === "string") return c.trim();

  // 그 외는 fmtAny로 안전 처리(너 파일에 이미 있음)
  return fmtAny(c);
}


function buildNotesFromDefinition(def: any): string | undefined {
  if (!def) return undefined;

  const parts: string[] = [];

  // 지속시간
  const dur = fmtDurationKo(def?.duration);
  if (dur) parts.push(`지속시간: ${dur}`);

  // 집중 (DDB는 durationType이 Concentration이거나 isConcentration이 true인 경우가 있음)
  const durType = String(def?.duration?.durationType ?? "").toLowerCase();
  const isConc = def?.isConcentration === true || durType.includes("concentration");
  if (isConc) parts.push("집중");

  // 구성요소
  const comps = fmtComponentsKo(def?.components);
  if (comps) parts.push(`구성요소: ${comps}`);

  // (선택) 사거리도 붙이고 싶으면 여기에서
  // const range = fmtRange(def?.range);
  // if (range) parts.push(`사거리: ${range}`);

  return parts.length ? parts.join(" / ") : undefined;
}



function fmtRange(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return `${v}피트`;

  // DDB range object 형태 대응
  const range = v?.range ?? v?.value ?? v?.normal ?? null;
  const long = v?.longRange ?? v?.long ?? null;

  // 전부 null/undefined면 빈 문자열
  if (range == null && long == null) return "";

  // mile 같은 단위가 붙을 수도 있어서 unit도 반영
  const unit = String(v?.unit ?? "").toLowerCase();
  const suffix =
    unit.includes("mile") ? "마일" :
    unit.includes("meter") ? "m" :
    unit.includes("foot") || unit.includes("feet") ? "피트" :
    "피트";

  const fmt = (n: any) => (n == null ? "" : `${Number(n)}${suffix}`);
  if (long != null) return `${fmt(range)}/${fmt(long)}`;
  return fmt(range);
}


/** name 필드 뽑기 */
function getName(node: any): string {
  return String(node?.name ?? node?.label ?? node?.title ?? "").trim();
}

/** 주문 "같아 보이는" 힌트들 */
function isSpellLike(node: any): boolean {
  if (!node || typeof node !== "object") return false;
  const name = getName(node);
  if (!name) return false;

  const hay = [
    node?.type,
    node?.actionType,
    node?.subType,
    node?.category,
    node?.sourceType,
    node?.snippet,
    node?.description,
    node?.displayAs,
  ]
    .map((x) => String(x ?? "").toLowerCase())
    .join(" ");

  // "spell" 단서
  const hasSpellWord = hay.includes("spell") || hay.includes("cantrip");

  // 주문 메타 단서(어느 하나라도 있으면 주문일 가능성 높음)
  const hasSpellMeta =
    node?.spellLevel != null ||
    node?.level != null ||
    node?.school != null ||
    node?.components != null ||
    node?.castingTime != null ||
    node?.duration != null ||
    node?.range != null ||
    node?.isConcentration != null ||
    node?.concentration != null ||
    node?.ritual != null ||
    node?.isRitual != null ||
    node?.spellId != null ||
    node?.definition?.spellLevel != null;

  // 공격/내성 단서
  const hasAttackOrSave =
    node?.toHit != null ||
    node?.toHitBonus != null ||
    node?.attackBonus != null ||
    node?.saveDc != null ||
    node?.dc != null ||
    node?.saveAbility != null ||
    node?.savingThrow != null;

  // 무기 공격과 섞이는 걸 조금 피하려고, spell 단서 또는 spellMeta가 있는 경우 우선
  return (hasSpellWord || hasSpellMeta) && (hasAttackOrSave || hasSpellMeta);
}

function isProbablyFeature(node: any): boolean {
  const hay = [
    node?.type,
    node?.actionType,
    node?.sourceType,
    node?.category,
    node?.displayAs,
  ].map(x => String(x ?? "").toLowerCase()).join(" ");

  // 흔한 feature/feat 단서
  if (hay.includes("feat")) return true;
  if (hay.includes("feature")) return true;
  if (hay.includes("class feature")) return true;
  if (hay.includes("racial trait")) return true;

// War Caster 같은 명시적 제외(원하면 확장)
const nodeNameLower = String(node?.name ?? "").toLowerCase();
if (nodeNameLower === "war caster") return true;


  return false;
}

/** raw 전체를 훑어서 spellLike node 수집 */
function deepCollectSpellLikeNodes(root: any): any[] {
  const found: any[] = [];
  const seen = new Set<any>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }

    if (isSpellLike(node)) found.push(node);

    for (const k of Object.keys(node)) {
      walk((node as any)[k]);
    }
  };

  walk(root);
  return found;
}

/** 설명/효과 텍스트 뽑기(버프/유틸 핵심) */
function pickEffect(node: any): string | undefined {
  const cand =
    node?.effect ??
    node?.snippet ??
    node?.description ??
    node?.shortDescription ??
    node?.longDescription ??
    node?.definition?.snippet ??
    node?.definition?.description ??
    node?.definition?.shortDescription ??
    node?.definition?.longDescription;

  const raw = fmtAny(cand);
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;

  // ✅ HTML 태그 제거는 cleaned 만든 다음에
  const noHtml = cleaned.replace(/<[^>]+>/g, "").trim();
  if (!noHtml) return undefined;

  // 너무 길면 코코포리아 채팅 부담 줄이기
  if (noHtml.length > 240) return noHtml.slice(0, 240) + "…";
  return noHtml;
}


/** 메모(사거리/시전시간/지속시간/집중/구성요소 등) */
function buildNotes(node: any): string | undefined {
  const rangeRaw = node?.range ?? node?.spellRange ?? node?.attackRange ?? node?.definition?.range;
  const casting = node?.castingTime ?? node?.definition?.castingTime;
  const duration = node?.duration ?? node?.definition?.duration;
  const conc = node?.isConcentration ?? node?.concentration ?? node?.definition?.isConcentration;
  const comps = node?.components ?? node?.definition?.components;
  const target = node?.target ?? node?.definition?.target ?? node?.areaOfEffect ?? node?.definition?.areaOfEffect;

  const parts: string[] = [];
  const range = fmtRange(rangeRaw);
  if (range) parts.push(`사거리: ${range}`);
  const c = fmtAny(casting);
  if (c) parts.push(`시전시간: ${c}`);
  const d = fmtAny(duration);
  if (d) parts.push(`지속시간: ${d}`);
  if (conc === true) parts.push(`집중`);
  const cp = fmtAny(comps);
  if (cp) parts.push(`구성요소: ${cp}`);
  const t = fmtAny(target);
  if (t) parts.push(`대상/범위: ${t}`);

  const out = parts.join(" / ").trim();
  return out || undefined;
}

/** spell 능력치 추정: node에 있으면 그걸, 없으면 wis로 (너의 기존 Thorn Whip 가정 유지) */
function pickSpellAbilityKey(node: any): AbilityKey {
  const raw =
    node?.spellcastingAbility ??
    node?.spellAbility ??
    node?.ability ??
    node?.definition?.spellcastingAbility ??
    node?.definition?.ability;

  const s = String(raw ?? "").toLowerCase();
  if (s.includes("int")) return "int";
  if (s.includes("wis")) return "wis";
  if (s.includes("cha")) return "cha";
  // 기본값
  return "wis";
}

function computeToHit(base: NormalizedBasic, ability: AbilityKey): number {
  const bonus = (base as any)?.spellAttackBonusBonus ?? 0;
  return (base.proficiencyBonus ?? 2) + (base.abilityMods?.[ability] ?? 0) + bonus;
}

/** 노드 하나를 NormalizedSpellAction으로 변환 */
function normalizeSpellNode(node: any, base: NormalizedBasic): NormalizedSpellAction | null {
  const spellName = getName(node);           // ✅ 무조건 맨 위에서 선언
  if (!spellName) return null;

  // 공격 굴림 보너스 후보
  const toHitRaw =
    node?.toHitBonus ?? node?.attackBonus ?? node?.toHit ?? node?.hitBonus ?? null;

  // 내성 DC 후보
  const dcRaw =
    node?.dc ?? node?.saveDc ?? node?.savingThrowDc ?? node?.spellSaveDc ?? null;

  // 내성 능력치 후보
  const saveKeyRaw =
    node?.saveAbility ?? node?.savingThrowAbility ?? node?.dcAbility ?? node?.definition?.saveAbility ?? null;
  const saveKey = String(saveKeyRaw ?? "").toLowerCase().trim();
  const saveAbilityKo = SAVE_KO[saveKey];

  // 피해
  const dmgDice =
    node?.damage?.diceString ??
    node?.damageDiceString ??
    node?.damageString ??
    node?.damage ??
    node?.definition?.damage?.diceString ??
    null;

  const dmgType =
    node?.damageType ??
    node?.damage?.damageType ??
    node?.damage?.type ??
    node?.definition?.damageType ??
    node?.definition?.damage?.damageType ??
    null;

  const damage = dmgDice ? String(dmgDice) : undefined;
  const damageTypeKo = dmgType ? toKoDamageType(dmgType) : undefined;

  const effect = pickEffect(node);
  const notes = buildNotes(node);

  // 1) spell_attack
  if (toHitRaw != null) {
    const toHit = Number.isFinite(Number(toHitRaw))
      ? Number(toHitRaw)
      : computeToHit(base, pickSpellAbilityKey(node));

    return {
      kind: "spell_attack",
      name: spellName,             // ✅ 여기 전부 spellName 사용
      toHitBonus: toHit,
      damage,
      damageTypeKo,
      effect,
      notes,
    };
  }

  // 2) spell_save
  if (dcRaw != null || saveAbilityKo) {
    const dc = Number.isFinite(Number(dcRaw)) ? Number(dcRaw) : 0;

    return {
      kind: "spell_save",
      name: spellName,
      dc,
      saveAbilityKo,
      damage,
      damageTypeKo,
      effect,
      notes,
    };
  }

  // 3) spell_other
  return {
    kind: "spell_other",
    name: spellName,
    effect,
    notes,
  };
}


/**
 * 기존 Thorn Whip "완벽" 함수는 유지 (네가 이미 만족했으니까)
 */
function deepFindByName(root: any, targetLower: string): any[] {
  const found: any[] = [];
  const seen = new Set<any>();

  const walk = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (const it of node) walk(it);
      return;
    }

    const name = String(node?.name ?? node?.label ?? node?.title ?? "").toLowerCase().trim();
    if (name && name === targetLower) found.push(node);

    for (const k of Object.keys(node)) {
      walk((node as any)[k]);
    }
  };

  walk(root);
  return found;
}

function makePerfectThornWhip(hit: any, base: NormalizedBasic): NormalizedSpellAction {
  const spellAbility: AbilityKey = "wis";
  const toHit = (base.proficiencyBonus ?? 2) + (base.abilityMods?.[spellAbility] ?? 0);

  const rangeRaw =
    hit?.range ??
    hit?.rangeValue ??
    hit?.attackRange ??
    hit?.spellRange ??
    hit?.distance ??
    hit?.targetRange ??
    30;

  const dmgDice =
    hit?.damage?.diceString ??
    hit?.damageDiceString ??
    hit?.damageString ??
    hit?.damage ??
    "1d6";

  const dmgType =
    hit?.damageType ??
    hit?.damage?.damageType ??
    hit?.damage?.type ??
    "piercing";

  const dmgTypeKo = toKoDamageType(dmgType) ?? "관통";

  const notes = [
    `사거리: ${fmtAny(rangeRaw) || "30피트"}`,
    `명중 시 10피트 끌어당김(대상 크기 조건 있음)`,
  ].join(" / ");

  return {
    kind: "spell_attack",
    name: "Thorn Whip",
    toHitBonus: toHit,
    damage: String(dmgDice),
    damageTypeKo: dmgTypeKo,
    notes,
  };
}

function computeSpellSaveDC(base: NormalizedBasic, ability: AbilityKey): number {
  const bonus = (base as any)?.spellSaveDcBonus ?? 0;
  return 8 + (base.proficiencyBonus ?? 2) + (base.abilityMods?.[ability] ?? 0) + bonus;
}

const ABILITY_ID_TO_KEY: Record<number, AbilityKey> = {
  1: "str",
  2: "dex",
  3: "con",
  4: "int",
  5: "wis",
  6: "cha",
};


function normalizeSpellFromClassSpell(
  spell: any,
  base: NormalizedBasic
): NormalizedSpellAction | null {
  const def = spell?.definition;
  const spellName = def?.name;
  if (!spellName) return null;

  const notes = buildNotesFromDefinition(def);
  // 드루이드/워락 등 주문시전 능력치 (지금은 wis 고정, 나중에 확장 가능)
const spellAbility: AbilityKey = "wis";

// ✅ 공격 주문(명중 굴림) 먼저 처리
if (def?.requiresAttackRoll === true || def?.attackType != null) {
  const toHit = computeToHit(base, spellAbility);

  // 피해도 description에서 뽑아오기 (네가 이미 만든 pickDamageFromDescription 재사용)
  const lvl = Number(base?.level ?? 0); // 없으면 임시로 7
  const dmg = pickDamageFromDescription(def, lvl);

  return {
    kind: "spell_attack",
    name: String(spellName),
    toHitBonus: toHit,
    damage: dmg?.dice,
    damageTypeKo: dmg?.damageTypeKo,
    notes,
  };
}

  // ✅ 내성 주문
  if (def?.requiresSavingThrow) {
    const saveKey = pickSaveKeyFromDef(def);
    if (saveKey) {
      const dc = computeSpellSaveDC(base, spellAbility);

      // ✅ 여기 추가: description에서 피해 파싱
      const lvl = Number(base?.level ?? 0); // base에 level이 없다면, 네가 계산한 레벨을 base에 넣거나 여기 다른 값으로 대체
      const dmg = pickDamageFromDescription(def, lvl);

      return {
        kind: "spell_save",
        name: String(spellName),
        dc,
        saveAbilityKo: SAVE_KO[saveKey],
        damage: dmg?.dice,
        damageTypeKo: dmg?.damageTypeKo,
        notes,
      };
    }
  }

  return {
    kind: "spell_other",
    name: String(spellName),
    notes,
  };
}


function pickSaveKeyFromDef(def: any): AbilityKey | null {
  const s = String(
    def?.savingThrowType ??
    def?.savingThrowAbility ??
    def?.saveAbility ??
    def?.saveStat ??
    ""
  ).toLowerCase().trim();

  if (s === "str" || s === "dex" || s === "con" || s === "int" || s === "wis" || s === "cha") {
    return s;
  }

  const id =
    def?.saveDcAbilityId ??
    def?.savingThrowStatId ??
    def?.saveStatId ??
    def?.savingThrowAbilityId ??
    def?.savingThrowId ??
    null;

  const n = Number(id);
  if (Number.isFinite(n) && ABILITY_ID_TO_KEY[n]) return ABILITY_ID_TO_KEY[n];

  return null;
}




export function extractSpellActions(raw: any, base: NormalizedBasic): NormalizedSpellAction[] {
  const out: NormalizedSpellAction[] = [];

  const classSpells = (raw as any)?.classSpells;
  if (!classSpells) return out;

  const roots = Array.isArray(classSpells) ? classSpells : Object.values(classSpells);

  for (const cls of roots) {
    const spells = (cls as any)?.spells;
    if (!Array.isArray(spells)) continue;

    for (const spell of spells) {
      const s = normalizeSpellFromClassSpell(spell, base);
      if (s) out.push(s);
    }
  }

  // ✅ Thorn Whip 보정 (함수 안에 있어야 함)
  const hits = deepFindByName(raw?.actions ?? raw, "thorn whip");
  if (hits.length > 0) {
    const perfect = makePerfectThornWhip(hits[0], base);
    const idx = out.findIndex((x) => x.name.toLowerCase() === "thorn whip");
    if (idx >= 0) out[idx] = perfect;
    else out.unshift(perfect);
  }

  return out;
}





/** ✅ 코코포리아 커맨드 문자열로 변환 */
export function buildSpellCommandsKo(list: NormalizedSpellAction[]) {
  const lines: string[] = [];

  for (const s of list) {
    lines.push(`// [주문] ${s.name}`);

    if (s.kind === "spell_attack") {
      lines.push(`1d20+${s.toHitBonus} ▼ 명중: ${s.name}`);

      if (s.damage) {
        lines.push(`${s.damage} ▼ 피해: ${s.name} (${s.damageTypeKo ?? ""})`.trim());
      }

      if (s.effect) lines.push(`// 효과: ${s.effect}`);
    } else if (s.kind === "spell_save") {
      lines.push(`// 내성: ${s.saveAbilityKo ?? "?"} DC ${s.dc ?? "?"}`);

      if (s.damage) {
        lines.push(`${s.damage} ▼ 피해: ${s.name} (${s.damageTypeKo ?? ""})`.trim());
      }

      if (s.effect) lines.push(`// 효과: ${s.effect}`);
    } else {
      // spell_other (버프/유틸)
      if (s.effect) lines.push(`// 효과: ${s.effect}`);
    }

    if (s.notes) lines.push(`// 메모: ${s.notes}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}
