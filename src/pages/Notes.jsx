import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { nowLocalAR, stampNew, stampUpdate } from "../utils";
import { SearchBar, Fab, Modal, Loader, Toast } from "./Products";
import { useConfirm } from "../components/Confirm";

// Una nota se puede editar hasta 30 min después de creada. Pasado ese tiempo
// la compu rechaza el UPDATE en su sync, así que la UI tampoco lo ofrece.
const EDIT_WINDOW_MIN = 30;

const COLORS = [
  { key: "yellow", label: "Amarillo", card: "bg-amber-100 border-amber-300 dark:bg-amber-400/15 dark:border-amber-400/30", dot: "bg-amber-300" },
  { key: "green", label: "Verde", card: "bg-emerald-100 border-emerald-300 dark:bg-emerald-400/15 dark:border-emerald-400/30", dot: "bg-emerald-300" },
  { key: "blue", label: "Celeste", card: "bg-sky-100 border-sky-300 dark:bg-sky-400/15 dark:border-sky-400/30", dot: "bg-sky-300" },
  { key: "pink", label: "Rosa", card: "bg-pink-100 border-pink-300 dark:bg-pink-400/15 dark:border-pink-400/30", dot: "bg-pink-300" },
];
const colorOf = (key) => COLORS.find((c) => c.key === key) || COLORS[0];

// created_at viene como 'YYYY-MM-DD HH:MM:SS' en hora AR. Comparamos contra
// nowLocalAR() en el mismo formato: el huso del celu se cancela en la resta.
const parseAR = (s) => (s ? new Date(String(s).replace(" ", "T")).getTime() : NaN);

function minutesLeft(createdAt) {
  const t = parseAR(createdAt);
  if (Number.isNaN(t)) return 0; // sin fecha válida la tratamos como bloqueada
  return Math.max(0, Math.ceil((EDIT_WINDOW_MIN * 60000 - (parseAR(nowLocalAR()) - t)) / 60000));
}
const canEdit = (n) => minutesLeft(n?.created_at) > 0;

export default function Notes() {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(null); // nota abierta, o "nueva"
  const [toast, setToast] = useState("");
  const [, setTick] = useState(0);
  const confirm = useConfirm();

  // Relojito: refresca el "te quedan N min" y bloquea la nota al vencer,
  // sin que el usuario tenga que salir y volver a entrar.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .eq("is_deleted", 0)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false });
    setLoading(false);
    if (error) return flash("Error al cargar: " + error.message);
    setNotes(data || []);
  }
  useEffect(() => { load(); }, []);
  function flash(m) { setToast(m); setTimeout(() => setToast(""), 2500); }

  async function createNote({ title, content, color }) {
    const { error } = await supabase.from("notes").insert({
      title: title.trim() || null,
      content: content.trim() || null,
      color,
      pinned: 0,
      ...stampNew(),
    });
    if (error) return flash("No se pudo guardar: " + error.message);
    setOpen(null);
    await load();
    flash(`Nota creada ✓ Podés editarla por ${EDIT_WINDOW_MIN} min`);
  }

  async function saveNote(note, { title, content, color }) {
    if (!canEdit(note)) { setOpen(null); await load(); return flash("Pasaron los 30 min: la nota quedó bloqueada"); }
    const { error } = await supabase.from("notes").update({
      title: title.trim() || null,
      content: content.trim() || null,
      color,
      ...stampUpdate(),
    }).eq("uuid", note.uuid);
    if (error) return flash("No se pudo guardar: " + error.message);
    setOpen(null);
    await load();
    flash("Nota guardada ✓");
  }

  async function togglePin(note) {
    if (!canEdit(note)) return flash("Pasaron los 30 min: ya no se puede fijar ni desfijar");
    const { error } = await supabase.from("notes")
      .update({ pinned: note.pinned ? 0 : 1, ...stampUpdate() })
      .eq("uuid", note.uuid);
    if (error) return flash("No se pudo fijar: " + error.message);
    await load();
  }

  async function removeNote(note) {
    const nombre = note.title?.trim() || "esta nota";
    if (!(await confirm({ title: "Eliminar nota", message: `¿Eliminar ${nombre}?`, confirmText: "Eliminar", danger: true }))) return;
    const { error } = await supabase.from("notes")
      .update({ is_deleted: 1, ...stampUpdate() })
      .eq("uuid", note.uuid);
    if (error) return flash("No se pudo eliminar: " + error.message);
    setOpen(null);
    await load();
    flash("Nota eliminada");
  }

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    if (!t) return notes;
    return notes.filter((n) =>
      (n.title || "").toLowerCase().includes(t) || (n.content || "").toLowerCase().includes(t)
    );
  }, [notes, search]);

  return (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} count={filtered.length} />

      {loading ? <Loader /> : filtered.length === 0 ? (
        <p className="text-center text-subtle py-10">
          {search ? "Ninguna nota coincide" : "No hay notas todavía. Tocá + para crear una."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((n) => {
            const editable = canEdit(n);
            return (
              <div key={n.uuid} className={`rounded-2xl border p-3 flex flex-col gap-1.5 ${colorOf(n.color).card}`}>
                <div className="flex items-start justify-between gap-1">
                  <button onClick={() => setOpen(n)} className="flex-1 text-left min-w-0">
                    {n.title && <p className="font-bold text-fg text-sm break-words">{n.title}</p>}
                  </button>
                  {editable ? (
                    <button onClick={() => togglePin(n)} className="p-0.5 shrink-0" title={n.pinned ? "Desfijar" : "Fijar arriba"}>
                      <span className="material-symbols-outlined text-[18px] text-fg/70"
                        style={n.pinned ? { fontVariationSettings: "'FILL' 1" } : undefined}>push_pin</span>
                    </button>
                  ) : (
                    <span className="material-symbols-outlined text-[16px] text-fg/40 shrink-0" title="Bloqueada: pasaron los 30 min">lock</span>
                  )}
                </div>

                <button onClick={() => setOpen(n)} className="text-left">
                  {/* line-clamp: la tarjeta es un preview, el texto completo va en el modal */}
                  <p className="text-xs text-fg/80 whitespace-pre-wrap break-words line-clamp-6">{n.content}</p>
                </button>

                <div className="flex items-center justify-between gap-1 mt-auto pt-1">
                  <span className="text-[10px] text-fg/50">{(n.updated_at || "").slice(0, 16)}</span>
                  <button onClick={() => removeNote(n)} className="p-0.5" title="Eliminar">
                    <span className="material-symbols-outlined text-[16px] text-danger">delete</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Fab onClick={() => setOpen("nueva")} />

      {open && (
        <NoteModal
          note={open === "nueva" ? null : open}
          onClose={() => setOpen(null)}
          onCreate={createNote}
          onSave={saveNote}
          onDelete={removeNote}
        />
      )}
      {toast && <Toast text={toast} />}
    </div>
  );
}

function NoteModal({ note, onClose, onCreate, onSave, onDelete }) {
  const esNueva = !note;
  const [form, setForm] = useState({
    title: note?.title || "",
    content: note?.content || "",
    color: colorOf(note?.color).key,
  });
  const [saving, setSaving] = useState(false);
  const confirm = useConfirm();

  const editable = esNueva || canEdit(note);
  const restan = esNueva ? EDIT_WINDOW_MIN : minutesLeft(note.created_at);

  async function submit() {
    if (!form.title.trim() && !form.content.trim()) return;
    const texto = esNueva
      ? { title: "Crear nota", message: `Vas a poder editarla por ${EDIT_WINDOW_MIN} minutos.`, confirmText: "Crear" }
      : { title: "Guardar nota", message: "¿Guardar los cambios?", confirmText: "Guardar" };
    if (!(await confirm(texto))) return;
    setSaving(true);
    if (esNueva) await onCreate(form);
    else await onSave(note, form);
    setSaving(false);
  }

  return (
    <Modal title={esNueva ? "Nueva nota" : note.title?.trim() || "Nota"} onClose={onClose}>
      {editable ? (
        <p className="text-xs text-brand bg-surface-soft border border-line rounded-xl px-3 py-2">
          {esNueva
            ? `Después de crearla vas a tener ${EDIT_WINDOW_MIN} minutos para editarla.`
            : `Te queda${restan === 1 ? "" : "n"} ${restan} minuto${restan === 1 ? "" : "s"} para editarla.`}
        </p>
      ) : (
        <p className="text-xs text-muted bg-surface-soft border border-line rounded-xl px-3 py-2 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">lock</span>
          Pasaron los {EDIT_WINDOW_MIN} min. Solo podés verla o eliminarla.
        </p>
      )}

      <div>
        <label className="block text-xs text-muted mb-1">Título</label>
        <input
          type="text"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          disabled={!editable}
          placeholder="Opcional"
          className="w-full px-3 py-2 border border-line rounded-xl focus:outline-none focus:border-brand disabled:opacity-60"
        />
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Contenido</label>
        <textarea
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
          disabled={!editable}
          rows={7}
          placeholder="Escribí lo que quieras acordarte..."
          className="w-full px-3 py-2 border border-line rounded-xl focus:outline-none focus:border-brand disabled:opacity-60 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Color</label>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button
              key={c.key}
              onClick={() => editable && setForm({ ...form, color: c.key })}
              disabled={!editable}
              title={c.label}
              className={`w-9 h-9 rounded-full ${c.dot} disabled:opacity-50 ${
                form.color === c.key ? "ring-2 ring-offset-2 ring-brand ring-offset-surface" : ""
              }`}
            />
          ))}
        </div>
      </div>

      {editable && (
        <button onClick={submit} disabled={saving}
          className="w-full py-3 bg-brand-solid text-white rounded-xl font-bold disabled:opacity-60">
          {saving ? "Guardando..." : esNueva ? "Crear nota" : "Guardar cambios"}
        </button>
      )}

      {!esNueva && (
        <button onClick={() => onDelete(note)}
          className="w-full py-2.5 bg-surface border border-danger text-danger rounded-xl font-semibold">
          Eliminar nota
        </button>
      )}
    </Modal>
  );
}
