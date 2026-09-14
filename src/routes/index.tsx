import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  BadgeCheck,
  Copy,
  Download,
  ExternalLink,
  FileUp,
  LoaderCircle,
  ShieldAlert,
  UploadCloud,
  Wand2Sparkles,
} from "lucide-react";
import { subirMatriculaPdf, type SubidaResultado } from "../lib/upload-url";

export const Route = createFileRoute("/")({
  component: MatriculaUploader,
});

type Fase = "inicio" | "validando" | "subiendo" | "ok" | "error";

interface ResultadoEstado extends SubidaResultado {
  fase: Fase;
  mensaje?: string;
}

const ENDPOINT_VISIBLE = "POST /api/documents/upload";

function MatriculaUploader() {
  const [nombre, setNombre] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [fase, setFase] = useState<Fase>("inicio");
  const [progreso, setProgreso] = useState(0);
  const [resultado, setResultado] = useState<ResultadoEstado | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Reset the whole form after a successful upload so the next student flows cleanly.
  useEffect(() => {
    if (fase !== "ok") return;
    const t = setTimeout(() => {
      setFase("inicio");
      setArchivo(null);
      setProgreso(0);
      setResultado(null);
      setNombre("");
      setCopiado(false);
    }, 9000);
    return () => clearTimeout(t);
  }, [fase]);

  const seleccionar = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = Array.from(files)[0];
    if (typeof f.type === "string" && f.type && !/^application\/pdf|^image\/pdf/i.test(f.type) && !/\.(pdf)$/i.test(f.name)) {
      toast.warning("Solo acepta PDFs (.pdf) por ahora.");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error("El archivo supera el límite de 20 MB.");
      return;
    }
    setArchivo(f);
    setNome(f.name);
    setFase("validando");
    setResultado(null);
  }, []);

  const enviar = useCallback(async () => {
    if (!archivo) {
      toast.error("Selecciona primero tu documento.");
      return;
    }
    setFase("subiendo");
    setProgreso(0);
    try {
      const r = await subirMatriculaPdf(archivo, (pct) => setProgreso(prev => Math.max(prev, pct)));
      setResultado(r);
      setProgreso(100);
      setFase("ok");
      toast.success("PDF subido correctamente ✅");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Algo salió mal durante la subida.";
      setResultado({ ok: false, error: msg, fase: "error" });
      setFase("error");
      toast.error(msg);
    }
  }, [archivo]);

  const copiar = useCallback(async () => {
    if (!resultado?.finalUrl) return;
    try {
      await navigator.clipboard.writeText(resultado.finalUrl);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Fallback: temporary select-on-click behaviour
      toast.info("Selecciona el enlace con clic derecho para copiarlo.");
    }
  }, [resultado]);

  const descargar = useCallback(() => {
    if (!resultado?.finalUrl) return;
    const a = document.createElement("a");
    a.href = resultado.finalUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [resultado]);

  const reiniciar = useCallback(() => {
    setFase("inicio");
    setArchivo(null);
    setProgreso(0);
    setResultado(null);
    setNombre("");
    setCopiado(false);
  }, []);

  const ocupado = fase === "subiendo" || fase === "validando";
  const pct = useMemo(() => Math.min(100, Math.max(0, progreso)), [progreso]);

  return (
    <div className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col justify-center gap-6 py-8">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 rounded-full border bg-white/70 px-3 py-1 text-xs font-medium uppercase tracking-wide text-emerald-700 shadow-sm backdrop-blur">
          <BadgeCheck className="h-3.5 w-3.5" />
          USAL · DigitalStack
        </div>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Sube tu matricula <span className="text-emerald-600">al instante</span>
        </h1>
        <p className="text-base text-muted-foreground">
          Elige tu PDF, pulsa <strong>“Subir”</strong> y copia tu enlace directo cuando esté listo. Nada más.
        </p>
      </header>

      <Card className="shadow-lg shadow-emerald-900/5">
        <CardHeader>
          <CardTitle>Paso 1 · Elige tu PDF</CardTitle>
          <CardDescription>
            Máximo 20&nbsp;MB. Al seleccionar se muestra arriba su tamaño real para confirmar que está bien.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Hidden native input – drives selection through both “click to browse” + drag-drop zone. */}
          <input
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => seleccionar(e.currentTarget.files)}
            onClick={() => {
              // Reset so picking the SAME pdf again fires change.
              e.currentTarget.value = "";
            }}
            id="sel-pdf"
            aria-describedby="desc-pdf"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => document.getElementById("sel-pdf")?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                document.getElementById("sel-pdf")?.click();
              }
            }}
            draggable
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              seleccionar(e.dataTransfer.files);
            }}
            className={`group relative flex min-h-[170px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
              archivo
                ? "border-emerald-400 bg-emerald-50/60 hover:border-emerald-500 hover:bg-emerald-50"
                : "border-stone-300 bg-white hover:-translate-y-0.5 hover:border-emerald-400 hover:bg-emerald-50/60 hover:shadow-md hover:shadow-emerald-100"
            }`}
          >
            <span
              className={`mb-3 grid h-14 w-14 place-items-center rounded-full transition-transform duration-300 ${
                archivo
                  ? "scale-100 bg-emerald-100 text-emerald-600"
                  : "group-hover:scale-110 bg-gradient-to-br from-emerald-100 to-teal-100 text-emerald-600 group-hover:rotate-[-6deg]"
              }`}
            >
              <UploadCloud className="h-7 w-7" strokeWidth={1.6} />
            </span>
            <span className="text-sm font-semibold text-emerald-900">{archivo ? "Cambiar de archivo…" : "Haz clic para elegir tu PDF"}</span>
            <span className="mt-1 text-xs text-muted-foreground">…o arrástralo hasta aquí</span>
            <span className="sr-only" id="desc-pdf">Zona de selección: solo se aceptan archivos PDF.</span>
          </div>

          {/* Selected-file strip */}
          {archivo && (
            <div className="flex items-center gap-3 rounded-lg border bg-white/70 px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-600 ring-1 ring-red-100">
                <FileUp className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={archivo.name}>
                  {archivo.name}
                </p>
                <p className="text-xs text-muted-foreground">{tamano(archivo)}</p>
              </div>
              {!ocupado && (
                <button
                  type="button"
                  onClick={reiniciar}
                  className="text-xs font-medium text-emerald-700 hover:underline"
                >
                  Quitar
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Big action area */}
      <Card className={`transition-shadow shadow-lg shadow-emerald-900/5 ${fase === "ok" ? "ring-2 ring-emerald-400/60" : ""}`} data-state={fase}>
        <CardHeader>
          <CardTitle>
            Paso 2 ·{" "}
            {fase === "subiendo" && (
              <>
                <LoaderCircle className="mr-2 inline-block h-4 w-4 animate-spin" />
                Subiendo a DigitalStack…
              </>
            )}
            {fase === "validando" && (
              <>
                <LoaderCircle className="mr-2 inline-block h-4 w-4 animate-spin" /> Validando
              </>
            )}
            {(fase === "inicio" || fase === "error") && "Enviar cuando estés listo"}
            {fase === "ok" && "¡Listo! Tu enlace directo está abajo 👇"}
          </CardTitle>
          <CardDescription>{ENDPOINT_VISIBLE} · folder /matriculas · .pdf</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            type="button"
            onClick={enviar}
            disabled={!archivo || ocupado}
            size="lg"
            className={`${
              fase === "subiendo"
                ? "animate-pulse bg-emerald-600 text-white"
                : "bg-emerald-600 text-white hover:bg-emerald-700"
            } w-full`}
          >
            {fase === "subiendo" ? "Subiendo…" : ocupado ? "Trabajando…" : "Subir"}
            {!ocupado && <Wand2Sparkles className="ml-2 h-4 w-4" />}
          </Button>

          {/* Live progress bar (real xhr progress events → honest %, not a lie) */}
          <div className={`overflow-hidden transition-opacity ${ocupado ? "opacity-100" : "opacity-60"}`}>
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{ocupado ? `Enviando ${tamano(archivo!)}` : "Espera al botón verde"}</span>
              <span className="tabular-nums">{pct}%</span>
            </div>
            <Progress value={pct} className="h-2.5 rounded-full bg-emerald-100" />
          </div>

          {/* Success panel */}
          {fase === "ok" && resultado?.finalUrl && (
            <div className="grid gap-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                <ShieldAlert className="h-4 w-4 rotate-180" /> Tu enlace final:
              </div>
              <Input
                readOnly
                onFocus={(e) => e.currentTarget.select()}
                value={resultado.finalUrl}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={copiar} variant={copiado ? "secondary" : "default"}>
                  {copiado ? <><BadgeCheck className="h-4 w-4 mr-1"/> Copiado ✓</> : <><Copy className="h-4 w-4 mr-1"/> Copiar</>}
                </Button>
                <Button size="sm" variant="outline" onClick={descargar}>
                  <Download className="mr-1 h-4 w-4" /> Descargar
                </Button>
                <Button size="sm" variant="ghost" onClick={reiniciar}>Nuevo archivo</Button>
                <Separator orientation="vertical" className="mx-1 hidden h-4 sm:block" />
                <a href={resultado.finalUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-emerald-700 underline-offset-2 hover:underline inline-flex items-center gap-1">
                  Abrir <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
              <p className="text-xs text-emerald-800/80">
                Comparte ese enlace con quien necesite el PDF. Es permanente mientras el archivo siga en DigitalStack.
              </p>
            </div>
          )}

          {/* Error panel */}
          {fase === "error" && (
            <div className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50/60 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-rose-900">
                <ShieldAlert className="h-4 w-4" /> Falló la subida
              </div>
              <p className="text-sm text-rose-800">{resultado?.mensaje ?? "Inténtalo otra vez; si persiste, verifica tu conexión con la red de la USAL."}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={enviar}>Reintentar</Button>
                <Button size="sm" variant="outline" onClick={reiniciar}>Empezar de nuevo</Button>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          Sin cookies ni cuentas: cada PDF genera su propio enlace único dentro de <code>/sites/default/files/matriculas/</code>.
        </CardFooter>
      </Card>

      <footer className="pb-4 pt-2 text-center text-xs text-muted-foreground">
        Hecho con cariño para estudiantes USAL 💚
      </footer>
    </div>
  );
}

function tamano(f: File): string {
  const mb = f.size / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  const kb = f.size / 1024;
  if (kb >= 1) return `${kb.toFixed(0)} KB`;
  return `${f.size} B`;
}
