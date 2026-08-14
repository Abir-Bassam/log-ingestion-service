// مؤشّر الصفحات المُعتّم 
// (opaque cursor).
// بنشفر موقع آخر صف شافه المستخدم: 
// (ts, id)
// هالطريقة اسمها keyset pagination،
// وبتضل سريعة مهما غُصنا عميق — بعكس 
// OFFSET اللي بيعيد مسح كل
// الصفوف اللي بيتخطّاها.

export interface CursorPos {
  ts: string; // وقت آخر صف (ISO)
  id: string; // الـ id كنص، لأنه bigint وأرقام JS ما بتحمله بأمان
}

// بنحوّل الموقع لنص base64url — المستخدم بيشوفه كنص مبهم وبيرجّعه
// زي ما هو.
export function encodeCursor(pos: CursorPos): string {
  return Buffer.from(JSON.stringify(pos)).toString("base64url");
}

// بنفكّ التشفير. بنرجّع null لأي شي مش إحنا مولّدينه — عشان
// نرفضه ب 400 بدل ما ينهار.
export function decodeCursor(raw: string): CursorPos | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.ts !== "string" ||
      typeof parsed.id !== "string" ||
      Number.isNaN(Date.parse(parsed.ts)) ||
      !/^\d+$/.test(parsed.id)
    ) {
      return null;
    }
    return { ts: parsed.ts, id: parsed.id };
  } catch {
    return null;
  }
}