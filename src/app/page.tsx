"use client";

import React, { useMemo, useState } from "react";

import { normalizeBasic } from "../lib/ddbNormalize";
import { extractAttacks, buildAttackListKo } from "../lib/ddbAttacks";
import { extractFeatureLists, buildFeatureListKo } from "../lib/ddbFeatures";
import { buildItemListKo } from "../lib/ddbItems";
import { buildCcfoliaCharacterJson, stringifyCcfoliaJson } from "../lib/ccfolia";

type AbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

const ABILITY_ID_TO_KEY: Record<number, AbilityKey> = {
  1: "str",
  2: "dex",
  3: "con",
  4: "int",
  5: "wis",
  6: "cha",
};

// src/app/page.tsx

// src/app/page.tsx

function getSpellAbilityFromDdb(raw: any): AbilityKey {
  const classes = Array.isArray(raw?.classes) ? raw.classes : [];
  
  // 1. D&D Beyond가 명시한 ID가 있으면 확인
  for (const c of classes) {
    const def = c?.definition ?? c?.class?.definition ?? c?.class;
    const id = Number(def?.spellCastingAbilityId ?? def?.spellcastingAbilityId ?? 0);
    if (id && ABILITY_ID_TO_KEY[id]) return ABILITY_ID_TO_KEY[id];
  }

  // 2. ID가 없으면 클래스 이름으로 추측 (여기가 중요!)
  // ✅ 이전 코드에는 이 부분이 없어서 위저드여도 매력(CHA)으로 계산되고 있었습니다.
  for (const c of classes) {
    // definition.name 뿐만 아니라 class.name 등 여러 곳을 찔러봅니다.
    const name = String(c?.definition?.name ?? c?.class?.definition?.name ?? c?.class?.name ?? "").toLowerCase();
    
    if (name.includes("wizard") || name.includes("artificer") || name.includes("rogue") || name.includes("fighter")) return "int";
    if (name.includes("cleric") || name.includes("druid") || name.includes("ranger") || name.includes("monk")) return "wis";
    if (name.includes("warlock") || name.includes("sorcerer") || name.includes("bard") || name.includes("paladin")) return "cha";
  }

  // 3. 진짜 모르겠으면 CHA
  return "cha";
}

function getMonkLevel(raw: any): number {
  const classes = Array.isArray(raw?.classes) ? raw.classes : [];
  for (const c of classes) {
    const name = String(c?.definition?.name ?? c?.class?.definition?.name ?? c?.class?.name ?? "");
    if (name.toLowerCase() === "monk") return Number(c?.level ?? 0) || 0;
  }
  return 0;
}

export default function Home() {
  const [ddbInput, setDdbInput] = useState("");
  const [playerName, setPlayerName] = useState("");

  const [status, setStatus] = useState<string>("");
  const [ddbCharRaw, setDdbCharRaw] = useState<any>(null);

  const [attackText, setAttackText] = useState("");
  const [spellText, setSpellText] = useState("");
  const [featureText, setFeatureText] = useState("");
  const [itemText, setItemText] = useState("");
  const [ccfoliaJson, setCcfoliaJson] = useState("");

  const canConvert = useMemo(() => !!ddbCharRaw, [ddbCharRaw]);

  async function fetchFromDdb() {
    setStatus("가져오는 중...");
    setDdbCharRaw(null);

    try {
      const r = await fetch("/api/ddb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urlOrId: ddbInput }),
      });

      const j = await r.json();
      if (!j?.ok) {
        setStatus(`가져오기 실패: ${j?.error ?? "ok=false"}`);
        return;
      }

      // 우리가 쓰는 실제 캐릭터 페이로드
      const raw = j?.data?.data;
      if (!raw?.name) {
        setStatus("가져오기 실패: 캐릭터 데이터가 비정상이에요.");
        return;
      }

      setDdbCharRaw(raw);
      setStatus(`가져오기 완료: ${String(raw.name)}`);
    } catch (e: any) {
      setStatus(`가져오기 오류: ${String(e?.message ?? e)}`);
    }
  }

  function convertNow() {
    if (!ddbCharRaw) return;

    try {
      const base = normalizeBasic(ddbCharRaw);

      // 공격 목록 (비무장타격 포함용 meta)
      const monkLevel = getMonkLevel(ddbCharRaw);
      const isMonk = monkLevel > 0;

      const attacks = extractAttacks(ddbCharRaw, base);
      const atk = buildAttackListKo(attacks, {
        proficiencyBonus: base.proficiencyBonus,
        strMod: base.abilityMods.str,
        dexMod: base.abilityMods.dex,
        isMonk,
        monkLevel,
      });

      // 주문 명중/DC 요약 (딱 2줄만)
      // 주문 명중/DC 요약
     const spellAbility = getSpellAbilityFromDdb(ddbCharRaw);
      const mod = base.abilityMods[spellAbility] ?? 0;
      
      // ✅ [수정] 아이템 보너스(spellAttackBonusBonus)까지 모두 더하기
      const itemAtk = base.spellAttackBonusBonus ?? 0;
      const itemDc = base.spellSaveDcBonus ?? 0;

      const spellAttackBonus = base.proficiencyBonus + mod + itemAtk;
      const spellSaveDc = 8 + base.proficiencyBonus + mod + itemDc;

      // 주문 능력치가 뭔지(INT인지 WIS인지)도 같이 보여주면 디버깅하기 좋습니다.
      const sp = `주문 능력치: ${spellAbility.toUpperCase()} (수정치 ${mod >= 0 ? "+" + mod : mod})\n주문 명중 1d20+${spellAttackBonus}\n주문 내성 DC ${spellSaveDc}`;
	  
	  
	  
	  // 피쳐/피트 목록
      const features = extractFeatureLists(ddbCharRaw);
      const ft = buildFeatureListKo(features);
	  
	  const it = buildItemListKo(ddbCharRaw);
      setItemText(it);

      // 코코포리아 JSON (commands는 빈 값)
      const cc = buildCcfoliaCharacterJson({
        base,
        playerName: playerName.trim() || undefined,
        attackCommandsKo: "",
      });

      setAttackText(atk);
      setSpellText(sp);
      setFeatureText(ft);
      setCcfoliaJson(stringifyCcfoliaJson(cc));
      setStatus("변환 완료");
    } catch (e: any) {
      setStatus(`변환 오류: ${String(e?.message ?? e)}`);
    }
  }

  async function copyJson() {
    if (!ccfoliaJson.trim()) return;
    await navigator.clipboard.writeText(ccfoliaJson);
    alert("CCFOLIA JSON 복사 완료!");
  }

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>DDB → CCFOLIA</h1>

      <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>D&D Beyond 캐릭터 링크/ID</div>
          <input
            value={ddbInput}
            onChange={(e) => setDdbInput(e.target.value)}
            placeholder="예) https://www.dndbeyond.com/characters/138861197/xxxx 또는 138861197"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>플레이어 이름(선택)</div>
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="예) 토피넛"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={fetchFromDdb}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #222" }}
          >
            DDB 가져오기
          </button>
          <button
            onClick={convertNow}
            disabled={!canConvert}
            style={{
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #222",
              opacity: canConvert ? 1 : 0.5,
            }}
          >
            변환
          </button>
          <div style={{ alignSelf: "center", color: "#555" }}>{status}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[무기 공격]</div>
          <textarea
            value={attackText}
            readOnly
            rows={8}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </section>

        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[주문]</div>
          <textarea
            value={spellText}
            readOnly
            rows={3}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </section>

        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[피쳐/피트]</div>
          <textarea
            value={featureText}
            readOnly
            rows={10}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </section>
		
		<section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[장비/소지금]</div>
          <textarea
            value={itemText}
            readOnly
            rows={8}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </section>
		
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>[CCFOLIA JSON]</div>
            <button
              onClick={copyJson}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #222" }}
            >
              JSON 복사
            </button>
          </div>
          <textarea
            value={ccfoliaJson}
            readOnly
            rows={14}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" }}
          />
        </section>
      </div>
    </main>
  );
}
