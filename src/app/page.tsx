"use client";

import React, { useMemo, useState } from "react";

import { normalizeBasic } from "../lib/ddbNormalize";
import { extractAttacks, buildAttackListKo } from "../lib/ddbAttacks";
import { extractFeatureLists, buildFeatureListKo } from "../lib/ddbFeatures";
import { buildItemListKo } from "../lib/ddbItems";
import { buildCcfoliaCharacterJson, stringifyCcfoliaJson } from "../lib/ccfolia";
import { buildSpellListKo } from "../lib/ddbSpells";

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
      const raw = j?.data?.data;
      if (!raw?.name) {
        setStatus("실패: 데이터 비정상");
        return;
      }
      setDdbCharRaw(raw);
      setStatus(`완료: ${String(raw.name)}`);
    } catch (e: any) {
      setStatus(`오류: ${String(e?.message ?? e)}`);
    }
  }

  function convertNow() {
    if (!ddbCharRaw) return;

    try {
      // 1. 기본 스탯
      const base = normalizeBasic(ddbCharRaw);

      // 2. 공격
      const monkLevel = getMonkLevel(ddbCharRaw);
      const isMonk = monkLevel > 0;
      const attacks = extractAttacks(ddbCharRaw, base);
      const atk = buildAttackListKo(attacks, base);

      // 3. 주문
      const sp = buildSpellListKo(ddbCharRaw, base);

      // 4. 피쳐 & 아이템
      const features = extractFeatureLists(ddbCharRaw);
      const ft = buildFeatureListKo(features);
      const it = buildItemListKo(ddbCharRaw);

      setAttackText(atk);
      setSpellText(sp);
      setFeatureText(ft);
      setItemText(it);

      // ✅ [핵심 수정] 메모 양식 변경
      // 요청: [클래스][Level][배경][서브클래스][피트]

      // 1) 클래스 이름만 (멀티클래스 고려)
      const classNames = base.classes.map(c => c.name).join(" / ");
      
      // 2) 서브클래스 이름만 (없으면 빈칸)
      const subNames = base.classes
        .map(c => c.subclass)
        .filter(Boolean)
        .join(" / ");
      
      // 3) 배경
      const bgLine = features.background ? `[배경] ${features.background}` : "";
      
      // 4) 피트
      const featsLine = features.feats.length > 0 ? `[피트]\n${features.feats.join("\n")}` : "";

      // 5) 최종 조립
      const customMemo = [
        `[클래스] ${classNames}`,
        `[Level] ${base.level}`,
        bgLine,
        subNames ? `[서브클래스] ${subNames}` : "",
        featsLine
      ].filter(Boolean).join("\n\n");

      // JSON 생성
      const cc = buildCcfoliaCharacterJson({
        base,
        customMemo,       // ✅ 커스텀 메모 적용
        noCommands: true, // ✅ 명령어 비우기
        // 아래는 화면 표시용 (메모엔 안 들어감)
        attackList: atk,
        spellList: sp,
        featureList: ft,
        itemList: it,
      });

      setCcfoliaJson(stringifyCcfoliaJson(cc));
      setStatus("변환 완료! (메모 재설정 / 명령 비움)");
    } catch (e: any) {
      console.error(e);
      setStatus(`변환 오류: ${String(e?.message ?? e)}`);
    }
  }

  async function copyJson() {
    if (!ccfoliaJson) return;
    await navigator.clipboard.writeText(ccfoliaJson);
    alert("JSON 복사 완료!");
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
            placeholder="ID 입력"
            style={{ padding: 10, border: "1px solid #ccc", borderRadius: 8 }}
          />
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={fetchFromDdb} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc" }}>가져오기</button>
          <button onClick={convertNow} disabled={!canConvert} style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc", background: canConvert ? "#eee" : "transparent" }}>변환</button>
          <div style={{ alignSelf: "center" }}>{status}</div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[무기 공격]</div>
          <textarea value={attackText} readOnly rows={6} style={boxStyle} />
        </section>

        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[주문]</div>
          <textarea value={spellText} readOnly rows={8} style={boxStyle} />
        </section>

        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[피쳐/피트]</div>
          <textarea value={featureText} readOnly rows={6} style={boxStyle} />
        </section>
        
        <section>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>[장비/소지금]</div>
          <textarea value={itemText} readOnly rows={6} style={boxStyle} />
        </section>
        
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>[CCFOLIA JSON]</div>
            <button
              onClick={copyJson}
              style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #222", background: "#333", color: "#fff" }}
            >
              JSON 복사
            </button>
          </div>
          <textarea
            value={ccfoliaJson}
            readOnly
            placeholder="변환 후 복사하세요."
            rows={10}
            style={{ ...boxStyle, background: "#f9f9f9" }}
          />
        </section>
      </div>
    </main>
  );
}

const boxStyle = { width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ccc" };