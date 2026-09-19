import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import { formatMoney, formatNum, stampUpdate, stampNew } from "../utils";
import { SearchBar, Field, IconBtn, Fab, Modal, Loader, Toast } from "./Products";
import { useConfirm } from "../components/Confirm";

const EMPTY = { name: "", last_name: "", phone: "", gmail: "" };

export default function Accounts() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY);
  const [detail, setDetail] = useState(null);
  const [toast, setToast] = useState("");
  const confirm = useConfirm();

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("accounts").select("*").eq("is_deleted", 0).order("name");
    setItems(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  function flash(m) { setToast(m); setTimeout(() => setToast(""), 2500); }

  async function addAccount() {
    if (!addForm.name.trim() || !addForm.last_name.trim()) return flash("Nombre y apellido obligatorios");
    if (!(await confirm({ title: "Crear cuenta", message: `¿Crear la cuenta de "${addForm.name.trim()} ${addForm.last_name.trim()}"?`, confirmText: "Crear" }))) return;
    const { error } = await supabase.from("accounts").insert({
      name: addForm.name.trim(),
      last_name: addForm.last_name.trim(),
      phone: addForm.phone || null,
      gmail: addForm.gmail || null,
      ...stampNew(),
    });
    if (error) return flash("Error: " + error.message);
    setShowAdd(false); setAddForm(EMPTY); await load(); flash("Cuenta creada ✓");
  }

  async function doDelete(a) {
    if (!(await confirm({ title: "Dar de baja", message: `¿Ocultar la cuenta de "${a.name} ${a.last_name}"? El historial se conserva.`, confirmText: "Dar de baja", danger: true }))) return;
    const { error } = await supabase.from("accounts").update({ is_deleted: 1, ...stampUpdate() }).eq("uuid", a.uuid);
    if (error) return flash("Error: " + error.message);
    await load(); flash("Cuenta dada de baja");
  }

  const filtered = useMemo(() => {
    const t = search.toLowerCase().trim();
    if (!t) return items;
    return items.filter((a) => `${a.name} ${a.last_name} ${a.phone || ""} ${a.gmail || ""}`.toLowerCase().includes(t));
  }, [items, search]);

  return (
    <div className="space-y-3">
      <SearchBar value={search} onChange={setSearch} count={filtered.length} />

      {loading ? <Loader /> : filtered.length === 0 ? (
        <p className="text-center text-subtle py-10">No hay cuentas</p>
      ) : filtered.map((a) => (
        <div key={a.uuid} className="bg-surface rounded-2xl p-4 border border-line flex items-center gap-3">
          <div className="w-11 h-11 rounded-full bg-brand/10 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-brand">person</span>
          </div>
          <button className="flex-1 text-left" onClick={() => setDetail(a)}>
            <p className="font-bold text-fg">{a.name} {a.last_name}</p>
            <p className="text-xs text-muted">{a.phone || a.gmail || "Sin datos"}</p>
          </button>
          <IconBtn icon="chevron_right" color="var(--color-subtle)" onClick={() => setDetail(a)} />
          <IconBtn icon="delete" color="var(--color-danger)" onClick={() => doDelete(a)} />
        </div>
      ))}

      <Fab onClick={() => { setAddForm(EMPTY); setShowAdd(true); }} />

      {showAdd && (
        <Modal title="Nueva cuenta" onClose={() => setShowAdd(false)}>
          <Field label="Nombre *" value={addForm.name} onChange={(v) => setAddForm({ ...addForm, name: v })} text />
          <Field label="Apellido *" value={addForm.last_name} onChange={(v) => setAddForm({ ...addForm, last_name: v })} text />
          <Field label="Teléfono" value={addForm.phone} onChange={(v) => setAddForm({ ...addForm, phone: v })} text />
          <Field label="Email" value={addForm.gmail} onChange={(v) => setAddForm({ ...addForm, gmail: v })} text />
          <button onClick={addAccount} className="w-full py-3 bg-brand-solid text-white rounded-xl font-bold">Crear cuenta</button>
        </Modal>
      )}

      {detail && <AccountDetail account={detail} onClose={() => setDetail(null)} />}
      {toast && <Toast text={toast} />}
    </div>
  );
}

function AccountDetail({ account, onClose }) {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ quantity: "", total_price: "" });
  const [toast, setToast] = useState("");
  const confirm = useConfirm();

  async function load() {
    const { data } = await supabase.from("sales").select("*").eq("account_id", String(account.id)).eq("is_deleted", 0).order("created_at", { ascending: false });
    setSales(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [account]);
  function flash(m) { setToast(m); setTimeout(() => setToast(""), 2500); }

  const total = sales
    .filter((s) => s.product_type !== "account_close")
    .reduce((a, s) => a + Number(s.total_price || 0), 0);

  // Agrupar por sale_group_id
  const groups = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      const g = s.sale_group_id || s.uuid;
      if (!m.has(g)) m.set(g, { fecha: s.created_at, items: [] });
      m.get(g).items.push(s);
    }
    return [...m.values()];
  }, [sales]);

  // Todas las filas de una venta repiten sale_total (History y Caja lo leen
  // de ahí), así que tras tocar un ítem hay que dejarlo consistente en todas.
  async function syncGroupTotal(groupId, remaining) {
    if (!groupId) return null;
    const sum = remaining.reduce((a, s) => a + Number(s.total_price || 0), 0);
    const { error } = await supabase.from("sales")
      .update({ sale_total: sum, ...stampUpdate() })
      .eq("sale_group_id", groupId).eq("is_deleted", 0);
    return error;
  }

  function openEdit(it) {
    setEditForm({ quantity: String(it.quantity ?? ""), total_price: String(it.total_price ?? "") });
    setEditing(it);
  }

  async function saveEdit() {
    const qty = Number(editForm.quantity);
    const price = Number(editForm.total_price);
    const custom = editing.product_type === "custom";
    if (!custom && (!Number.isFinite(qty) || qty <= 0)) return flash("Cantidad inválida");
    if (!Number.isFinite(price) || price < 0) return flash("Precio inválido");

    const patch = { total_price: price, ...stampUpdate() };
    if (!custom) {
      patch.quantity = qty;
      patch.unit_price = qty > 0 ? price / qty : editing.unit_price;
    }
    if (!editing.sale_group_id) patch.sale_total = price;

    const { error } = await supabase.from("sales").update(patch).eq("uuid", editing.uuid);
    if (error) return flash("Error: " + error.message);

    const remaining = sales
      .filter((s) => s.sale_group_id === editing.sale_group_id)
      .map((s) => (s.uuid === editing.uuid ? { ...s, total_price: price } : s));
    const err2 = await syncGroupTotal(editing.sale_group_id, remaining);
    if (err2) return flash("Error: " + err2.message);

    setEditing(null); await load(); flash("Ítem actualizado ✓");
  }

  async function deleteItem(it) {
    const ok = await confirm({
      title: "Quitar ítem",
      message: `¿Quitar "${it.product_name}" (${formatMoney(it.total_price)}) de la cuenta de ${account.name}? El registro se oculta, no se borra.`,
      confirmText: "Quitar",
      danger: true,
    });
    if (!ok) return;

    const { error } = await supabase.from("sales").update({ is_deleted: 1, ...stampUpdate() }).eq("uuid", it.uuid);
    if (error) return flash("Error: " + error.message);

    const remaining = sales.filter((s) => s.sale_group_id === it.sale_group_id && s.uuid !== it.uuid);
    const err2 = await syncGroupTotal(it.sale_group_id, remaining);
    if (err2) return flash("Error: " + err2.message);

    await load(); flash("Ítem quitado");
  }

  return (
    <Modal title={`${account.name} ${account.last_name}`} onClose={onClose}>
      <div className="bg-brand/5 rounded-xl p-3 flex items-center justify-between">
        <span className="text-sm text-muted">Total gastado (últ. 3 meses)</span>
        <span className="text-xl font-extrabold text-brand">{formatMoney(total)}</span>
      </div>
      {loading ? <Loader /> : groups.length === 0 ? (
        <p className="text-center text-subtle py-6">Sin movimientos en la nube</p>
      ) : (
        <div className="space-y-2">
          {groups.map((g, i) => (
            <div key={i} className="border border-line rounded-xl p-3">
              <p className="text-xs text-subtle mb-1">{(g.fecha || "").slice(0, 16)}</p>
              {g.items.map((it) => {
                const isClose = it.product_type === "account_close";
                return (
                  <div key={it.uuid} className="flex items-center gap-1 text-sm py-0.5">
                    <span className="flex-1 text-fg">
                      {isClose ? "🔒 Cierre" : it.product_name}
                      {!isClose && it.product_type !== "custom" &&
                        <span className="text-subtle"> ×{formatNum(it.quantity, it.quantity % 1 === 0 ? 0 : 2)}</span>}
                    </span>
                    <b className="text-fg">{formatMoney(it.total_price)}</b>
                    {!isClose && (
                      <>
                        <IconBtn icon="edit" color="var(--color-brand)" onClick={() => openEdit(it)} />
                        <IconBtn icon="delete" color="var(--color-danger)" onClick={() => deleteItem(it)} />
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal title={`Editar: ${editing.product_name}`} onClose={() => setEditing(null)}>
          {editing.product_type !== "custom" && (
            <Field label="Cantidad" value={editForm.quantity} onChange={(v) => setEditForm({ ...editForm, quantity: v })} />
          )}
          <Field label="Precio total ($)" value={editForm.total_price} onChange={(v) => setEditForm({ ...editForm, total_price: v })} />
          <button onClick={saveEdit} className="w-full py-3 bg-brand-solid text-white rounded-xl font-bold">Guardar cambios</button>
        </Modal>
      )}
      {toast && <Toast text={toast} />}
    </Modal>
  );
}
