import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiRequestError, type CraneOptions, type CraneParams, type DesignSummary } from "./api.ts";

type ParamKey = keyof CraneParams;
type FormValues = { name: string } & Record<ParamKey, string>;

/** Starting values = the reference drawing from the brief. */
const DEFAULTS: FormValues = {
  name: "New crane",
  capacityKg: "10000",
  spanMm: "25000",
  railHeightMm: "8321",
  liftingHeightMm: "7900",
};

const PARAM_KEYS: ParamKey[] = ["capacityKg", "spanMm", "railHeightMm", "liftingHeightMm"];

/** Empty input becomes NaN -> JSON null, which the server rejects with a field error. */
function toParams(v: FormValues): CraneParams {
  const num = (s: string) => (s.trim() === "" ? Number.NaN : Number(s));
  return {
    capacityKg: num(v.capacityKg),
    spanMm: num(v.spanMm),
    railHeightMm: num(v.railHeightMm),
    liftingHeightMm: num(v.liftingHeightMm),
  };
}

function fromDesign(d: { name: string; params: CraneParams }): FormValues {
  return {
    name: d.name,
    capacityKg: String(d.params.capacityKg),
    spanMm: String(d.params.spanMm),
    railHeightMm: String(d.params.railHeightMm),
    liftingHeightMm: String(d.params.liftingHeightMm),
  };
}

/** Maps server error details ("params.spanMm", "name") to form field keys. */
function fieldErrorsFrom(err: unknown): Record<string, string> {
  if (!(err instanceof ApiRequestError)) return {};
  const out: Record<string, string> = {};
  for (const d of err.details) {
    const key = d.path.replace(/^params\./, "");
    out[key] ??= d.message;
  }
  return out;
}

/** Preview only knows about crane params, so it must not clear an error on the name field. */
function keepNameError(prev: Record<string, string>): Record<string, string> {
  return prev.name ? { name: prev.name } : {};
}

const sameValues =(a: FormValues, b: FormValues) =>
  a.name.trim() === b.name.trim() && PARAM_KEYS.every((k) => a[k] === b[k]);

interface Saved {
  id: number;
  version: number;
  values: FormValues;
}

type Status = { kind: "info" | "success" | "error"; text: string } | null;

export function App() {
  const [options, setOptions] = useState<CraneOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [designs, setDesigns] = useState<DesignSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [values, setValues] = useState<FormValues>(DEFAULTS);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "ok" | "invalid" | "error">("loading");
  const urlRef = useRef<string | null>(null);

  const dirty = saved ? !sameValues(values, saved.values) : true;

  /** Reloads the list from the first page (after a save, the edited design moves to the top). */
  const refreshList = useCallback(async () => {
    try {
      const page = await api.list();
      setDesigns(page.items);
      setNextCursor(page.nextCursor);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load designs");
    }
  }, []);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.list(nextCursor);
      // A design edited elsewhere between pages can move; skip ids already shown.
      setDesigns((prev) => {
        const shown = new Set((prev ?? []).map((d) => d.id));
        return [...(prev ?? []), ...page.items.filter((d) => !shown.has(d.id))];
      });
      setNextCursor(page.nextCursor);
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Could not load more designs");
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Opens the drawing in a new tab inside a tiny viewer page instead of opening
   * the SVG blob directly. A blob: SVG opened as a document runs in this app's
   * origin and could run script; inside <img> an SVG never runs script, and the
   * viewer's CSP allows nothing but the image.
   */
  function openFullSize() {
    if (!previewUrl) return;
    const html =
      `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob:; style-src 'unsafe-inline'">` +
      `<title>Crane drawing</title></head><body style="margin:0;background:#fff">` +
      `<img src="${previewUrl}" alt="Crane drawing" style="display:block;width:100%;height:auto"></body></html>`;
    const viewerUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    window.open(viewerUrl, "_blank", "noopener");
    // The new tab has loaded it by then; free the memory.
    setTimeout(() => URL.revokeObjectURL(viewerUrl), 60_000);
  }

  useEffect(() => {
    api.options().then(setOptions, (err: unknown) =>
      setOptionsError(err instanceof Error ? err.message : "Could not load options"),
    );
    void refreshList();
  }, [refreshList]);

  // Live preview: debounced, and a newer edit aborts the older request (last intent wins).
  const paramsKey = PARAM_KEYS.map((k) => values[k]).join("|");
  useEffect(() => {
    const ctrl = new AbortController();
    setPreviewState("loading");
    const timer = setTimeout(async () => {
      try {
        const res = await api.preview(toParams(values), ctrl.signal);
        const url = URL.createObjectURL(new Blob([res.svg], { type: "image/svg+xml" }));
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPreviewUrl(url);
        setPreviewState("ok");
        setFieldErrors(keepNameError);
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof ApiRequestError && err.code === "VALIDATION_FAILED") {
          setFieldErrors((prev) => ({ ...keepNameError(prev), ...fieldErrorsFrom(err) }));
          setPreviewState("invalid");
        } else {
          setPreviewState("error");
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // paramsKey captures exactly the inputs that change the drawing (not the name),
    // so typing a name does not re-render the preview.
  }, [paramsKey]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  function setField(key: keyof FormValues, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
    setStatus(null);
  }

  function confirmDiscard() {
    return !saved || !dirty || window.confirm("You have unsaved changes. Discard them?");
  }

  async function openDesign(id: number) {
    if (!confirmDiscard()) return;
    setBusy(true);
    try {
      const d = await api.get(id);
      const v = fromDesign(d);
      setValues(v);
      setSaved({ id: d.id, version: d.version, values: v });
      setFieldErrors({});
      setConflict(false);
      setStatus({ kind: "info", text: `Opened "${d.name}" (version ${d.version}).` });
    } catch (err) {
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Could not open design" });
    } finally {
      setBusy(false);
    }
  }

  function newDesign() {
    if (!confirmDiscard()) return;
    setValues(DEFAULTS);
    setSaved(null);
    setFieldErrors({});
    setConflict(false);
    setStatus(null);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setConflict(false);
    try {
      const params = toParams(values);
      const d = saved
        ? await api.update(saved.id, saved.version, values.name, params)
        : await api.create(values.name, params);
      const v = fromDesign(d);
      setValues(v);
      setSaved({ id: d.id, version: d.version, values: v });
      setFieldErrors({});
      setStatus({ kind: "success", text: `Saved "${d.name}" as version ${d.version}.` });
      void refreshList();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "VERSION_CONFLICT") setConflict(true);
      setFieldErrors(fieldErrorsFrom(err));
      setStatus({ kind: "error", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  const hint = (key: ParamKey): string => {
    if (!options) return "";
    const l = options.limits;
    if (key === "spanMm") return `${l.spanMm.min}–${l.spanMm.max} mm, rail centre to rail centre`;
    if (key === "railHeightMm") return `${l.railHeightMm.min}–${l.railHeightMm.max} mm, floor to top of runway rail`;
    if (key === "liftingHeightMm") {
      // Number("") is 0, so only show a maximum when the rail height itself is a valid value.
      const rail = Number(values.railHeightMm);
      const railValid =
        values.railHeightMm.trim() !== "" &&
        Number.isInteger(rail) &&
        rail >= l.railHeightMm.min &&
        rail <= l.railHeightMm.max;
      const range = railValid ? `${l.liftingHeightMm.min}–${rail - options.hookTopBelowRailMm}` : `at least ${l.liftingHeightMm.min}`;
      return `${range} mm, vertical hook travel`;
    }
    return "";
  };

  const numberField = (key: ParamKey, label: string) => (
    <div className="field">
      <label htmlFor={key}>{label}</label>
      <input
        id={key}
        type="number"
        inputMode="numeric"
        step={1}
        value={values[key]}
        onChange={(e) => setField(key, e.target.value)}
        aria-invalid={fieldErrors[key] ? true : undefined}
        aria-describedby={`${key}-hint${fieldErrors[key] ? ` ${key}-error` : ""}`}
      />
      <small id={`${key}-hint`}>{hint(key)}</small>
      {fieldErrors[key] && (
        <small id={`${key}-error`} className="error">
          {fieldErrors[key]}
        </small>
      )}
    </div>
  );

  return (
    <div className="layout">
      <header>
        <h1>Crane Drawing Generator</h1>
        <p>Single-girder overhead crane. Values marked * on the drawing are estimates. Not for construction.</p>
      </header>

      <aside aria-labelledby="saved-heading">
        <div className="aside-head">
          <h2 id="saved-heading">Saved designs</h2>
          <button type="button" onClick={newDesign} disabled={busy}>
            New
          </button>
        </div>
        {listError && (
          <p className="error" role="alert">
            {listError} <button type="button" onClick={() => void refreshList()}>Retry</button>
          </p>
        )}
        {!listError && designs === null && <p className="muted">Loading…</p>}
        {designs?.length === 0 && <p className="muted">No saved designs yet.</p>}
        {designs && designs.length > 0 && (
          <ul className="designs">
            {designs.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => void openDesign(d.id)}
                  disabled={busy}
                  aria-current={saved?.id === d.id ? "true" : undefined}
                >
                  <span className="design-name">{d.name}</span>
                  <span className="muted">
                    {d.params.capacityKg / 1000} t · {d.params.spanMm} mm span · v{d.version}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        )}
      </aside>

      <main>
        <form onSubmit={(e) => void save(e)} noValidate>
          <h2>{saved ? `Editing design #${saved.id}` : "New design"}</h2>
          {optionsError && (
            <p className="error" role="alert">
              {optionsError}
            </p>
          )}
          <div className="field">
            <label htmlFor="name">Design name</label>
            <input
              id="name"
              value={values.name}
              maxLength={100}
              onChange={(e) => setField("name", e.target.value)}
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
            />
            {fieldErrors.name && (
              <small id="name-error" className="error">
                {fieldErrors.name}
              </small>
            )}
          </div>
          <div className="field">
            <label htmlFor="capacityKg">Rated load</label>
            <select
              id="capacityKg"
              value={values.capacityKg}
              onChange={(e) => setField("capacityKg", e.target.value)}
              aria-invalid={fieldErrors.capacityKg ? true : undefined}
            >
              {(options?.capacitiesKg ?? [Number(DEFAULTS.capacityKg)]).map((kg) => (
                <option key={kg} value={kg}>
                  {kg / 1000} t
                </option>
              ))}
            </select>
            {fieldErrors.capacityKg && <small className="error">{fieldErrors.capacityKg}</small>}
          </div>
          {numberField("spanMm", "Span (mm)")}
          {numberField("railHeightMm", "Rail height (mm)")}
          {numberField("liftingHeightMm", "Lifting height (mm)")}

          <div className="actions">
            <button type="submit" className="primary" disabled={busy || (saved !== null && !dirty)}>
              {busy ? "Saving…" : saved ? "Save changes" : "Save design"}
            </button>
            {saved && !dirty && (
              <a className="button" href={api.drawingUrl(saved.id)} download>
                Download SVG
              </a>
            )}
          </div>
          <p className={`status ${status?.kind ?? ""}`} role="status" aria-live="polite">
            {status?.text}
            {conflict && saved && (
              <>
                {" "}
                <button type="button" onClick={() => void openDesign(saved.id)}>
                  Reload latest
                </button>
              </>
            )}
          </p>
        </form>

        <section className="preview" aria-labelledby="preview-heading">
          <h2 id="preview-heading">
            Drawing{" "}
            <span className="muted">
              {previewState === "loading" && "updating…"}
              {previewState === "invalid" && "fix the highlighted inputs to update"}
              {previewState === "error" && "preview failed, is the server running?"}
            </span>
          </h2>
          {previewUrl ? (
            <>
              <img
                src={previewUrl}
                alt="Dimensioned drawing of the crane: front elevation, plan view and technical data"
                className={previewState === "ok" ? "" : "stale"}
              />
              <p>
                <button type="button" onClick={openFullSize}>
                  Open full size
                </button>
              </p>
            </>
          ) : (
            <p className="muted">Preview appears here.</p>
          )}
        </section>
      </main>
    </div>
  );
}
