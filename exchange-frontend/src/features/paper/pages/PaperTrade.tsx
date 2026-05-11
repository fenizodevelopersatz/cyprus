import { useState } from "react";
import Button from "../../../ui/Button";
import Input from "../../../ui/Input";
import { usePaperEngine } from "../../../hooks/usePaperEngine";

export default function PaperTrade() {
  const engine = usePaperEngine();
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"BUY" | "SELL">("BUY");
  const [type, setType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [price, setPrice] = useState<string>("");
  const [qty, setQty] = useState<string>("0.01");

  const onPlace = () => {
    const p = type === "LIMIT" ? parseFloat(price) : undefined;
    const q = parseFloat(qty) || 0;
    engine.placeOrder({ symbol, side, type, price: p, qty: q });
  };

  const pos = engine.positions[symbol];
  const pnl = engine.unrealizedPnl(symbol);
  const mid = engine.prices[symbol];

  return (
    <div className="max-w-7xl mx-auto text-slate-100 space-y-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">Demo / Paper Trading</h1>
        <div className="text-sm text-slate-300/80">Equity: <span className="font-semibold text-white">${engine.equity.toLocaleString()}</span></div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: order form */}
        <div className="rounded-3xl border border-white/10 p-5 bg-white/6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
          <div className="mb-3 flex items-center gap-2">
            <select value={symbol} onChange={e => setSymbol(e.target.value)} className="border border-white/15 rounded-xl px-3 py-2 text-sm bg-white/10 text-white backdrop-blur focus:border-indigo-400 focus:outline-none">
              {engine.symbols.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}
            </select>
            <div className="text-sm text-slate-300/80">Mid: <span className="font-semibold text-white">{mid?.toLocaleString()}</span></div>
          </div>

          <div className="mb-2 flex gap-2">
            {(["BUY","SELL"] as const).map(v=>(
              <button key={v} onClick={()=>setSide(v)} className={`flex-1 px-3 py-1.5 rounded-lg border text-sm transition ${side===v ? (v==="BUY"?"bg-emerald-600 text-white border-emerald-600":"bg-rose-600 text-white border-rose-600") : "border-white/15 text-slate-200 hover:border-white/30"}`}>{v}</button>
            ))}
          </div>

          <div className="mb-3 flex gap-2">
            {(["MARKET","LIMIT"] as const).map(v=>(
              <button key={v} onClick={()=>setType(v)} className={`flex-1 px-3 py-1.5 rounded-lg border text-sm transition ${type===v ? "bg-indigo-600 text-white border-indigo-600" : "border-white/15 text-slate-200 hover:border-white/30"}`}>{v}</button>
            ))}
          </div>

          {type === "LIMIT" && (
            <div className="mb-3">
              <label className="text-xs text-slate-300/80">Price</label>
              <Input value={price} onChange={e=>setPrice(e.target.value)} placeholder={`${mid?.toFixed(2)}`} />
            </div>
          )}

          <div className="mb-3">
            <label className="text-xs text-slate-300/80">Quantity</label>
            <Input value={qty} onChange={e=>setQty(e.target.value)} placeholder="0.01" />
          </div>

          <Button onClick={onPlace} className="w-full" size="lg">{side} {type}</Button>

          <div className="mt-4 text-sm text-slate-300/80">
            Balance USDT: <span className="font-semibold text-white">{engine.balances.USDT.toLocaleString()}</span>
          </div>
        </div>

        {/* Middle: positions */}
        <div className="rounded-3xl border border-white/10 p-5 bg-white/6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(15,118,110,0.3)]">
          <div className="text-sm uppercase tracking-[0.18em] text-slate-300/70 mb-2">Position</div>
          {!pos || pos.qty === 0 ? (
            <div className="text-sm text-slate-300/80">No open position for {symbol}.</div>
          ) : (
            <div className="space-y-2 text-sm text-slate-200">
              <div className="flex justify-between"><span>Qty</span><span>{pos.qty}</span></div>
              <div className="flex justify-between"><span>Avg Price</span><span>{pos.avgPrice}</span></div>
              <div className="flex justify-between"><span>Mark (Mid)</span><span>{mid}</span></div>
              <div className={`flex justify-between ${pnl>=0?"text-emerald-500":"text-rose-500"}`}>
                <span>Unrealized PnL</span><span>{pnl.toFixed(2)} USDT</span>
              </div>
            </div>
          )}
        </div>

        {/* Right: orders */}
        <div className="rounded-3xl border border-white/10 p-5 bg-white/6 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(79,70,229,0.35)]">
          <div className="text-sm uppercase tracking-[0.18em] text-slate-300/70 mb-2">Recent Orders</div>
          <div className="space-y-2 text-sm text-slate-200 max-h-72 overflow-auto">
            {engine.orders.slice(0,20).map(o=>(
              <div key={o.id} className="grid grid-cols-6 gap-2 items-center">
                <div className="col-span-2">{o.symbol}</div>
                <div className={o.side==="BUY"?"text-emerald-500":"text-rose-500"}>{o.side}</div>
                <div>{o.type}</div>
                <div className="text-right">{o.qty}</div>
                <div className="text-right">{o.status}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Portfolio quick glance */}
      <div className="mt-4 rounded-3xl border border-white/10 bg-white/6 p-5 backdrop-blur-xl shadow-[0_25px_80px_-45px_rgba(59,130,246,0.3)]">
        <div className="text-sm uppercase tracking-[0.18em] text-slate-300/70 mb-2">Portfolio (Spot value + USDT)</div>
        <div className="text-lg font-semibold text-white">${engine.equity.toLocaleString()}</div>
      </div>
    </div>
  );
}
