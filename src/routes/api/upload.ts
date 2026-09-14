import { createApiHandler } from "@tanstack/react-start/server";
import axios from "axios";
import crypto from "node:crypto";

const DIGITALSTACK_BASE = "https://digitalstack.usal.es";
const UPLOAD_PATH = "/api/documents/upload";

const ABC = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Unique-ish filename → predictable, collision-free final URL. */
function slugify(name: string): string {
  const stem = (name || "").replace(/\.[^.]+$/, "");
  const slug =
    stem
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "matricula";
  const rand = [...crypto.randomBytes(8)].map((b) => ABC[b & 0x1f]).join("").slice(0, 8);
  return `${slug}_${rand}.pdf`;
}

async function grabSession(cookieJar: Record<string, string>): Promise<void> {
  const headers: Record<string, string> = {};
  Object.entries(cookieJar).forEach(([k, v]) => {
    headers[k.toLowerCase()] = v;
  });
  const res = await axios.get(DIGITALSTACK_BASE, {
    headers: { ...headers, Origin: DIGITALSTACK_BASE, Referer: `${DIGITALSTACK_BASE}/matricula`, "User-Agent": "Mozilla/5.0 (proxy)" },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    timeout: 30000,
  });
  // Collect cookies set by the homepage (Drupal session + CSRF cookie).
  (res.headers["set-cookie"] ?? []).forEach((c: string) => {
    const pair = c.split(";")[0]?.trim();
    if (!pair) return;
    const idx = pair.indexOf("=");
    if (idx <= 0) return;
    cookieJar[pair.slice(0, idx)] = pair.slice(idx + 1);
  });
}

function buildCookieString(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

export default createApiHandler({
  post: async ({ req, client }) => {
    const cookieJar: Record<string, string> = {};

    try {
      const formData = await req.formData();
      const fileObj = formData.get("file");

      if (!(fileObj instanceof File)) {
        return client.badRequest("No se recibió ningún archivo.").send();
      }
      if (fileObj.size > 50 * 1024 * 1024) {
        return client.payloadTooLarge("El archivo pesa demasiado (>50 MB)").send();
      }

      // Step 1: establish the Drupal session server-side (homepage GET).
      await grabSession(cookieJar);

      // Step 2: upload via the endpoint documented on /matricula.
      const form = new FormData();
      form.append("files[0]", fileObj, slugify(fileObj.name));

      const res = await axios.post(`${DIGITALSTACK_BASE}${UPLOAD_PATH}`, form, {
        headers: {
          Cookie: buildCookieString(cookieJar),
          Accept: "*/*",
          Origin: DIGITALSTACK_BASE,
          Referer: `${DIGITALSTACK_BASE}/matricula`,
          "User-Agent": "Mozilla/5.0 (proxy)",
          "X-Requested-With": "XMLHttpRequest",
        },
        maxRedirects: 5,
        validateStatus: (s) => s >= 200 && s < 500,
        timeout: 120000,
      });

      if (res.status >= 400) {
        const snippet = String(res.data ?? "").slice(0, 300);
        return client.internalServerError(`DigitalStack respondió HTTP ${res.status}: ${snippet}`).send();
      }

      let data: unknown = null;
      try {
        data = typeof res.data === "string" ? JSON.parse(res.data) : res.data;
      } catch {
        data = null;
      }

      // Extract a usable final URL from the Drupal/AJAX payload.
      let finalUrl: string | null = null;

      if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        const docs = obj.documents;
        if (Array.isArray(docs) && docs.length > 0) {
          const doc = docs[0] as Record<string, unknown>;
          const uri = typeof doc.uri === "string" ? doc.uri : null;
          if (uri?.startsWith("//")) finalUrl = "https:" + uri;
          else if (typeof uri === "string") {
            finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(uri) ? uri : `${DIGITALSTACK_BASE}/${uri.replace(/^\/+/, "")}`;
          }
        }
        if (!finalUrl) {
          const candidates = [obj.uri, obj.url, obj.file_url, obj.link, obj.path].filter((x) => typeof x === "string");
          const cand = candidates[0];
          if (cand) {
            finalUrl = /^https?:\/\//i.test(cand) ? cand : `${DIGITALSTACK_BASE}/${cand.replace(/^\/+/, "")}`;
          }
        }
      }

      if (!finalUrl) {
        // Last resort: if we got 2xx but no parseable URL, surface the raw payload so the frontend can adapt.
        const raw = typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? "");
        return client.internalServerError(`OK HTTP ${res.status}, pero no pude leer la URL: ${raw.slice(0, 500)}`).send();
      }

      return client.json({ ok: true, url: finalUrl }, { status: 200 });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return client.internalServerError(`Error interno: ${msg}`).send();
    }
  },
});
