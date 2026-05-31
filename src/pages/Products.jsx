import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, stampUpdate, stampNew } from "../utils";

const CATEGORIAS = ["Alimentos", "Limpieza", "Bazar", "Bebidas", "Perfumería"];
const EMPTY = { name: "", category: "", cost_price: "", unit_price: "", barcode: "" };

export default function Products() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null); // uuid en edición
  const [editForm, setEditForm] = useState({ cost_price: "", unit_price: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("products").select("*").eq("is_deleted", 0).order("name");
    setItems(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function flash(msg) { setToast(msg); setTimeout(() => setToast(""), 2500); }

  async function saveEdit(p) {
    const { error } = await supabase
      .from("products")
      .update({ cost_price: Number(editForm.cost_price) || 0, unit_price: Number(editForm.unit_price) || 0, ...stampUpdate() })
      .eq("uuid", p.uuid);
    if (error) return flash("Error: " + error.message);
    setEditing(null);
    await load();
    flash("Precio actualizado ✓");
  }

  async function addProduct() {
    if (!addForm.name.trim()) return flash("Poné un nombre");
    const { error } = await supabase.from("products").insert({
      name: addForm.name.trim(),
      category: addForm.category || null,
      cost_price: Number(addForm.cost_price) || 0,
      unit_price: Number(addForm.unit_price) || 0,
      quantity: 0,
      barcode: addForm.barcode || null,
      ...stampNew(),
    });
    if (error) return flash("Error: " + error.message);
    setShowAdd(false);
    setAddForm(EMPTY);
    await load();
    flash("Producto agregado ✓ (cargá el stock en la compu)");
  }

  async function doDelete(p) {
    const { error } = await supabase.from("products").update({ is_deleted: 1, ...stampUpdate() }).eq("uuid", p.uuid);
    if (error) return flash("Error: " + error.message);
    setConfirmDel(null);
    await load();
    flash("Producto dado de baja");
  }

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    return t ? items.filter((p) => p.name.toLowerCase().includes(t)) : items;
  }, [items, search]);

  return (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} count={filtered.length} />

      {loading ? (
        <Loader />
      ) : filtered.length === 0 ? (
        <p className="text-center text-[#94a3b8] py-10">No hay productos</p>
      ) : (
        filtered.map((p) => (
          <div key={p.uuid} className="bg-white rounded-2xl p-4 border border-[#e2e8f0]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="font-bold text-[#1e293b]">{p.name}</p>
                <p className="text-xs text-[#64748b]">{p.category || "Sin categoría"} · Stock: {p.quantity} u</p>
              </div>
              {editing !== p.uuid && (
                <div className="flex gap-1">
                  <IconBtn icon="edit" color="#0040a1" onClick={() => { setEditing(p.uuid); setEditForm({ cost_price: String(p.cost_price ?? ""), unit_price: String(p.unit_price ?? "") }); }} />
                  <IconBtn icon="delete" color="#ef4444" onClick={() => setConfirmDel(p)} />
                </div>
              )}
            </div>

            {editing === p.uuid ? (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Field label="Costo $" value={editForm.cost_price} onChange={(v) => setEditForm({ ...editForm, cost_price: v })} />
                <Field label="Venta $" value={editForm.unit_price} onChange={(v) => setEditForm({ ...editForm, unit_price: v })} />
                <div className="col-span-2 flex gap-2 mt-1">
                  <button onClick={() => saveEdit(p)} className="flex-1 py-2 bg-[#10b981] text-white rounded-xl font-semibold">Guardar</button>
                  <button onClick={() => setEditing(null)} className="px-4 py-2 bg-[#e2e8f0] text-[#1e293b] rounded-xl font-semibold">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-4">
                <span className="text-sm"><span className="text-[#64748b]">Costo </span><b className="text-[#ef4444]">{formatMoney(p.cost_price)}</b></span>
                <span className="text-sm"><span className="text-[#64748b]">Venta </span><b className="text-[#10b981]">{formatMoney(p.unit_price)}</b></span>
              </div>
            )}
          </div>
        ))
      )}

      <Fab onClick={() => { setAddForm(EMPTY); setShowAdd(true); }} />

      {showAdd && (
        <Modal title="Nuevo producto" onClose={() => setShowAdd(false)}>
          <Field label="Nombre *" value={addForm.name} onChange={(v) => setAddForm({ ...addForm, name: v })} text />
          <div>
            <label className="block text-xs text-[#64748b] mb-1">Categoría</label>
            <select value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
              className="w-full px-3 py-2 border border-[#e2e8f0] rounded-xl bg-white">
              <option value="">Seleccionar</option>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Costo $" value={addForm.cost_price} onChange={(v) => setAddForm({ ...addForm, cost_price: v })} />
            <Field label="Venta $" value={addForm.unit_price} onChange={(v) => setAddForm({ ...addForm, unit_price: v })} />
          </div>
          <Field label="Código de barras" value={addForm.barcode} onChange={(v) => setAddForm({ ...addForm, barcode: v })} text />
          <p className="text-xs text-[#94a3b8]">El stock se carga en la compu (por fardos/tandas).</p>
          <button onClick={addProduct} className="w-full py-3 bg-[#0040a1] text-white rounded-xl font-bold">Agregar</button>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Dar de baja" onClose={() => setConfirmDel(null)}>
          <p className="text-[#1e293b]">¿Ocultar <b>{confirmDel.name}</b>? No se borra el historial, solo deja de mostrarse.</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmDel(null)} className="flex-1 py-3 bg-[#e2e8f0] rounded-xl font-semibold">No</button>
            <button onClick={() => doDelete(confirmDel)} className="flex-1 py-3 bg-[#ef4444] text-white rounded-xl font-bold">Sí, dar de baja</button>
          </div>
        </Modal>
      )}

      {toast && <Toast text={toast} />}
    </div>
  );
}

/* ── UI helpers compartidos ── */
export function SearchBar({ value, onChange, count }) {
  return (
    <div className="relative">
      <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]">search</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Buscar..."
        className="w-full pl-10 pr-4 py-3 bg-white border border-[#e2e8f0] rounded-xl focus:outline-none focus:border-[#0040a1]" />
      {count != null && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#94a3b8]">{count}</span>}
    </div>
  );
}
export function Field({ label, value, onChange, text }) {
  return (
    <div>
      <label className="block text-xs text-[#64748b] mb-1">{label}</label>
      <input type={text ? "text" : "number"} inputMode={text ? "text" : "decimal"} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-[#e2e8f0] rounded-xl focus:outline-none focus:border-[#0040a1]" />
    </div>
  );
}
export function IconBtn({ icon, color, onClick }) {
  return (
    <button onClick={onClick} className="p-2 rounded-lg active:bg-[#f1f5f9]">
      <span className="material-symbols-outlined text-[20px]" style={{ color }}>{icon}</span>
    </button>
  );
}
export function Fab({ onClick }) {
  return (
    <button onClick={onClick}
      className="fixed right-5 bottom-24 z-30 w-14 h-14 rounded-full bg-[#0040a1] text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform">
      <span className="material-symbols-outlined text-[28px]">add</span>
    </button>
  );
}
export function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex items-end sm:items-center justify-center" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 space-y-3 max-h-[88vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#1e293b]">{title}</h2>
          <button onClick={onClose}><span className="material-symbols-outlined text-[#64748b]">close</span></button>
        </div>
        {children}
      </div>
    </div>
  );
}
export function Loader() {
  return <div className="flex justify-center py-16 text-[#64748b]"><span className="material-symbols-outlined animate-spin text-3xl">progress_activity</span></div>;
}
export function Toast({ text }) {
  return <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 bg-[#1e293b] text-white text-sm px-4 py-2 rounded-full shadow-lg">{text}</div>;
}
