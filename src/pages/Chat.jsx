import { useEffect, useRef, useState } from "react";
import { supabase } from "../supabase";

const SUGGESTIONS = [
  "¿Cuánto vendí hoy?",
  "¿Qué se está por vencer?",
  "Cambiale el precio a un producto",
  "Sumale stock a un producto",
  "¿Cuáles son los más vendidos de la semana?",
  "¿Cuánto vale el inventario?",
];

const WELCOME = {
  role: "assistant",
  text: "¡Hola! Soy Beto, el asistente del negocio. Puedo consultarte ventas, cuentas, stock y vencimientos, y también modificar productos: precio, costo, nombre, categoría y stock. ¿En qué te ayudo?",
};

export default function Chat() {
  const [messages, setMessages] = useState([WELCOME]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    // scroll al final cuando llega un mensaje
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(text) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || sending) return;

    setError("");
    setInput("");
    const newMessages = [...messages, { role: "user", text: trimmed }];
    setMessages(newMessages);
    setSending(true);

    try {
      // Mandamos el JWT actual para que la función acceda a Supabase con permisos del usuario
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: newMessages.slice(0, -1).filter((m) => m !== WELCOME),
          supabase_token: token,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

      setMessages((m) => [...m, { role: "assistant", text: data.reply }]);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 130px)" }}>
      {/* Encabezado del asistente */}
      <div className="bg-surface rounded-2xl p-3 border border-line flex items-center gap-3 mb-3">
        <div className="w-11 h-11 rounded-full bg-brand-solid flex items-center justify-center">
          <span className="material-symbols-outlined text-white">smart_toy</span>
        </div>
        <div>
          <p className="font-bold text-fg leading-tight">Beto — Asistente</p>
          <p className="text-xs text-muted">Consulta y modifica productos</p>
        </div>
      </div>

      {/* Historial */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 pb-2">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} text={m.text} />
        ))}
        {sending && <Bubble role="assistant" text="…" typing />}
        {error && (
          <div className="bg-danger/10 border border-danger/30 text-danger text-sm p-3 rounded-xl">
            {error}
          </div>
        )}
      </div>

      {/* Sugerencias (solo al inicio) */}
      {messages.length === 1 && !sending && (
        <div className="mb-2 -mx-1 pb-1">
          <p className="text-xs text-muted px-1 mb-1">Probá con:</p>
          <div className="flex gap-2 overflow-x-auto pb-1 px-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="whitespace-nowrap bg-surface border border-line text-brand text-xs font-semibold px-3 py-2 rounded-full active:bg-surface-mute"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send(); }}
        className="flex items-center gap-2 bg-surface p-2 rounded-2xl border border-line"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Preguntá algo del negocio…"
          disabled={sending}
          className="flex-1 px-3 py-2 outline-none text-sm bg-transparent"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="w-10 h-10 flex items-center justify-center rounded-xl bg-brand-solid text-white disabled:bg-subtle active:scale-95 transition-transform"
        >
          <span className="material-symbols-outlined text-[20px]">
            {sending ? "hourglass" : "send"}
          </span>
        </button>
      </form>
    </div>
  );
}

function Bubble({ role, text, typing }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-brand-solid flex items-center justify-center mr-2 shrink-0">
          <span className="material-symbols-outlined text-white text-[18px]">smart_toy</span>
        </div>
      )}
      <div
        className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-brand-solid text-white rounded-br-sm"
            : "bg-surface border border-line text-fg rounded-bl-sm"
        }`}
      >
        {typing ? (
          <span className="inline-flex items-center gap-1">
            <Dot delay={0} />
            <Dot delay={0.15} />
            <Dot delay={0.3} />
          </span>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return (
    <span
      className="inline-block w-1.5 h-1.5 rounded-full bg-subtle animate-bounce"
      style={{ animationDelay: `${delay}s` }}
    />
  );
}
