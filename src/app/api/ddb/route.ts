import { NextResponse } from "next/server";

export const runtime = "nodejs";

function extractId(input: string): string | null {
  // 1) 숫자만 넣은 경우
  if (/^\d+$/.test(input.trim())) return input.trim();

  // 2) 공유 링크에서 추출
  const m = input.match(/dndbeyond\.com\/characters\/(\d+)/i);
  return m ? m[1] : null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const input = String(body?.urlOrId ?? "").trim();

  const id = extractId(input);
  if (!id) {
    return NextResponse.json(
      { ok: false, error: "캐릭터 ID 또는 dndbeyond 캐릭터 링크를 넣어줘" },
      { status: 400 }
    );
  }

  // DDB 캐릭터 JSON 엔드포인트
  const endpoint = `https://character-service.dndbeyond.com/character/v5/character/${id}?includeCustomItems=true`;

  const res = await fetch(endpoint, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "application/json,text/plain,*/*",
      "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return NextResponse.json(
      {
        ok: false,
        error: `character-service fetch 실패: ${res.status} ${res.statusText}`,
        hint:
          "캐릭터가 Public이 아니면 막힐 수 있어. (Manage > Character Settings > Privacy: Public)",
        debug: text.slice(0, 500),
      },
      { status: 502 }
    );
  }

  const json = await res.json();
  return NextResponse.json({ ok: true, id, data: json });
}
