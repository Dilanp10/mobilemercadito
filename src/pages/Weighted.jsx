import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum, stampUpdate, stampNew } from "../utils";
import { SearchBar, Field, IconBtn, Fab, Modal, Loader, Toast } from "./Products";

const CATS = [
  { key: "frutas", label: "🍎 Frutas" },
  { key: "verduras", label: "🥬 Verduras" },
  { key: "carnes", label: "🥩 Carnes" },
  { key: "panaderia", label: "🥖 Panadería" },
  { key: "otros", label: "📦 Otros" },
];
const EMPTY = { name: "", category: "", cost_price_kg: "", price_kg: "" };

export default function Weighted() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ cost_price_kg: "", price_kg: "" });
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("weighted_products").select("*").eq("is_deleted", 0).order("name");
    setItems(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  function flash(m) { setToast(m); setTimeout(() => setToast(""), 2500); }

  async function saveEdit(p) {
    const { error } = await supabase.from("weighted_products").update({
      cost_price_kg: Number(editForm.cost_price_kg) || 0,
      price_kg: Number(editForm.price_kg) || 0,
      ...stampUpdate(),
    }).eq("uuid", p.uuid);
    if (error) return flash("Error: " + error.message);
    setEditing(null); await load(); flash("Precio actualizado ✓");
  }

  async function addItem() {
    if (!addForm.name.trim()) return flash("Poné un nombre");
    const { error } = await supabase.from("weighted_products").insert({
      name: addForm.name.trim(),
      category: addForm.category || null,
      cost_price_kg: Number(addForm.cost_price_kg) || 0,
      price_kg: Number(addForm.price_kg) || 0,
      stock: 0,
      ...stampNew(),
    });
    if (error) return flash("Error: " + error.message);
    setShowAdd(false); setAddForm(EMPTY); await load();
    flash("Producto agregado ✓ (cargá el stock en la compu)");
  }

  async function doDelete(p) {
    const { error } = await supabase.from("weighted_products").update({ is_deleted: 1, ...stampUpdate() }).eq("uuid", p.uuid);
    if (error) return flash("Error: " + error.message);
    setConfirmDel(null); await load(); flash("Producto dado de baja");
  }

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    return t ? items.filter((p) => p.name.toLowerCase().includes(t)) : items;
  }, [items, search]);

  return (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} count={filtered.length} />

      {loading ? <Loader /> : filtered.length === 0 ? (
        <p className="text-center text-[#94a3b8] py-10">No hay productos por peso</p>
      ) : filtered.map((p) => (
        <div key={p.uuid} className="bg-white rounded-2xl p-4 border border-[#e2e8f0]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="font-bold text-[#1e293b]">{p.name}</p>
              <p className="text-xs text-[#64748b]">{p.category || "Sin categoría"} · Stock: {formatNum(p.stock)} kg</p>
            </div>
            {editing !== p.uuid && (
              <div className="flex gap-1">
                <IconBtn icon="edit" color="#0040a1" onClick={() => { setEditing(p.uuid); setEditForm({ cost_price_kg: String(p.cost_price_kg ?? ""), price_kg: String(p.price_kg ?? "") }); }} />
                <IconBtn icon="delete" color="#ef4444" onClick={() => setConfirmDel(p)} />
              </div>
            )}
          </div>

          {editing === p.uuid ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Costo/kg $" value={editForm.cost_price_kg} onChange={(v) => setEditForm({ ...editForm, cost_price_kg: v })} />
              <Field label="Venta/kg $" value={editForm.price_kg} onChange={(v) => setEditForm({ ...editForm, price_kg: v })} />
              <div className="col-span-2 flex gap-2 mt-1">
                <button onClick={() => saveEdit(p)} className="flex-1 py-2 bg-[#10b981] text-white rounded-xl font-semibold">Guardar</button>
                <button onClick={() => setEditing(null)} className="px-4 py-2 bg-[#e2e8f0] rounded-xl font-semibold">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex gap-4">
              <span className="text-sm"><span className="text-[#64748b]">Costo/kg </span><b className="text-[#ef4444]">{formatMoney(p.cost_price_kg)}</b></span>
              <span className="text-sm"><span className="text-[#64748b]">Venta/kg </span><b className="text-[#10b981]">{formatMoney(p.price_kg)}</b></span>
            </div>
          )}
        </div>
      ))}

      <Fab onClick={() => { setAddForm(EMPTY); setShowAdd(true); }} />

      {showAdd && (
        <Modal title="Nuevo producto por peso" onClose={() => setShowAdd(false)}>
          <Field label="Nombre *" value={addForm.name} onChange={(v) => setAddForm({ ...addForm, name: v })} text />
          <div>
            <label className="block text-xs text-[#64748b] mb-1">Categoría</label>
            <select value={addForm.category} onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
              className="w-full px-3 py-2 border border-[#e2e8f0] rounded-xl bg-white">
              <option value="">Seleccionar</option>
              {CATS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Costo/kg $" value={addForm.cost_price_kg} onChange={(v) => setAddForm({ ...addForm, cost_price_kg: v })} />
            <Field label="Venta/kg $" value={addForm.price_kg} onChange={(v) => setAddForm({ ...addForm, price_kg: v })} />
          </div>
          <p className="text-xs text-[#94a3b8]">El stock se carga en la compu (por tandas).</p>
          <button onClick={addItem} className="w-full py-3 bg-[#0040a1] text-white rounded-xl font-bold">Agregar</button>
        </Modal>
      )}

      {confirmDel && (
        <Modal title="Dar de baja" onClose={() => setConfirmDel(null)}>
          <p className="text-[#1e293b]">¿Ocultar <b>{confirmDel.name}</b>? No se pierde el historial.</p>
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
