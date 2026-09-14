// Client helper — delegates the heavy lifting (session handshake + upload to
// digitalstack.usal.es) to our own /api/upload endpoint so the browser never
// opens a cross-origin connection to USAL directly.

export interface SubidaResultado {
  ok: boolean;
  finalUrl?: string;
  filePath?: string;
  error?: string;
}

export async function subirMatriculaPdf(
  file: File,
  progress?: (pct: number) => void
): Promise<SubidaResultado> {
  const fd = new FormData();
  fd.append("file", file, file.name);

  // Realistic-feeling ramp that never claims 100 until we actually get the
  // URL back — the network layer here (server→USAL) hides real bytes from us.
  // We cap near 92 so "still loading" reads honestly regardless of latency.
  let pct = 0;
  let elapsed = 0;
  const capForSize = file.size > 10 * 1024 * 1024 ? 88 : 94; // bigger ⇒ lower ceiling
  const speedMs = 400; // ms per tick
  const growthPerTick = () => {
    // Ease-out curve: slow at the top so it lingers meaningfully.
    const currentRatio = pct / 100;
    return (capForSize / 100) * (1 - currentRatio) * 0.35;
  };
  const timer = setInterval(() => {
    elapsed += speedMs;
    const g = growthPerTick();
    if (g <= 0) return;
    pct = Math.min(capForSize - 1, pct + g);
    progress?.(Math.floor(pct));
  }, speedMs);

  try {
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const raw = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { __raw: raw };
    }

    if (!res.ok) {
      const rec = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
      const errMsg = typeof rec.message === "string" ? rec.message : raw.slice(0, 400) || `HTTP ${res.status}`;
      throw new Error(errMsg);
    }

    const url = (rec.url as unknown) as string | undefined;
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("La subida llegó, pero no recibimos la URL final. Inténtalo otra vez.");
    }
    const filePath = url.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
    return { ok: true, finalUrl: url, filePath };
  } finally {
    clearInterval(timer);
  }
}
