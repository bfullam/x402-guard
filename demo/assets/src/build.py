#!/usr/bin/env python3
"""Builds the submission images (logo, cover, screenshots) as HTML, rendered to PNG by render.sh.
Screenshot terminals are the real `mm x402` output captured in src/*.txt."""
import html
import json
from pathlib import Path

SRC = Path(__file__).parent
OUT = SRC.parent

BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:%(w)dpx;height:%(h)dpx;overflow:hidden;background:#0b0f17;color:#e6edf3;
 font-family:-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",sans-serif}
.mono{font-family:"SF Mono",Menlo,Monaco,monospace}
"""

SHIELD = """
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#22d3a6"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
  <path d="M50 6 L86 19 V47 C86 70 70 86 50 94 C30 86 14 70 14 47 V19 Z" fill="url(#g)"/>
  <path d="M50 14 L79 24.5 V47 C79 65.5 66.5 78.5 50 85.5 C33.5 78.5 21 65.5 21 47 V24.5 Z" fill="#0b0f17"/>
  <text x="50" y="54" text-anchor="middle" font-family="SF Mono,Menlo,monospace" font-weight="700"
        font-size="25" fill="#e6edf3">402</text>
  <path d="M37 69 L46 76 L64 63" stroke="#22d3a6" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>"""


def page(name, w, h, body, css=""):
    (SRC / f"{name}.html").write_text(
        f"<!doctype html><meta charset=utf-8><style>{BASE_CSS % {'w': w, 'h': h}}{css}</style>{body}")


def color_line(line):
    e = html.escape(line)
    for sym, cls in (("✔", "ok"), ("✖", "bad"), ("▲", "warn"), ("?", "warn")):
        if line.lstrip().startswith(sym):
            return e.replace(sym, f'<span class="{cls}">{sym}</span>', 1)
    if line.startswith(("✅", "⛔", "✋")):
        cls = {"✅": "ok", "⛔": "bad", "✋": "warn"}[line[0]]
        return f'<b class="{cls}">{e}</b>'
    if line.startswith("  - "):
        return f'<span class="dim">{e}</span>'
    if line.startswith("Intent:"):
        return f'<span class="dim">{e}</span>'
    return e


def terminal(name, cmd, caption, sub, extra_lines=()):
    raw = (SRC / f"{name}.txt").read_text()
    text, _, js = raw.partition("__JSON__")
    lines = [color_line(l) for l in text.rstrip().splitlines()] + list(extra_lines)
    body = f"""
<div class="wrap">
  <div class="cap"><div class="t">{caption}</div><div class="s">{sub}</div></div>
  <div class="term"><div class="bar"><i></i><i></i><i></i><span>x402-guard · MetaMask Agent Wallet</span></div>
  <pre class="mono"><span class="prompt">$</span> {html.escape(cmd)}
{chr(10).join(lines)}</pre></div>
</div>"""
    css = """
.wrap{padding:40px 48px;height:100%;display:flex;flex-direction:column;gap:22px}
.cap .t{font-size:34px;font-weight:700;letter-spacing:-.5px}.cap .s{font-size:19px;color:#8b98a9;margin-top:6px}
.term{flex:1;background:#111827;border:1px solid #1f2a3a;border-radius:14px;overflow:hidden}
.bar{height:34px;background:#172033;display:flex;align-items:center;gap:8px;padding:0 14px;color:#8b98a9;font-size:13px}
.bar i{width:11px;height:11px;border-radius:50%;background:#2b3648;display:inline-block}.bar span{margin-left:8px}
pre{padding:18px 22px;font-size:16.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.prompt{color:#22d3a6}.ok{color:#34d399}.bad{color:#f87171}.warn{color:#fbbf24}.dim{color:#8b98a9}.link{color:#38bdf8}
"""
    page(name, 1280, 720, body, css)
    return json.loads(js) if js else {}


# Logo 512x512
page("logo", 512, 512, f'<div style="display:grid;place-items:center;height:100%">'
     f'<div style="width:380px;height:380px">{SHIELD}</div></div>')

# Cover 1280x720
page("cover", 1280, 720, f"""
<div style="display:flex;align-items:center;gap:56px;height:100%;padding:0 90px">
  <div style="width:300px;height:300px;flex:none">{SHIELD}</div>
  <div>
    <div style="font-size:78px;font-weight:800;letter-spacing:-2px">x402-guard</div>
    <div style="font-size:30px;color:#c3cedb;margin-top:10px;line-height:1.3">
      Screens every x402 payment before your agent signs it</div>
    <div style="display:flex;gap:14px;margin-top:36px;font-size:24px;font-weight:700" class="mono">
      <span style="padding:10px 18px;border-radius:10px;background:#0f2e25;color:#34d399">✅ PAY</span>
      <span style="padding:10px 18px;border-radius:10px;background:#3a1717;color:#f87171">⛔ REFUSE</span>
      <span style="padding:10px 18px;border-radius:10px;background:#3a2d0c;color:#fbbf24">✋ ASK HUMAN</span>
    </div>
    <div style="font-size:20px;color:#8b98a9;margin-top:34px">
      MetaMask Agent Wallet plugin · counterparty screening by Intercepta</div>
  </div>
</div>""")

pay = terminal("pay", "mm x402 pay http://127.0.0.1:4020/reports/market-data",
               "Clean seller → paid and settled",
               "Intercepta rates the payee clean; MetaMask signs; settled on Base Sepolia")
tx = (pay.get("settlement") or {}).get("transaction", "")
# Re-render with the settlement appended (from the same run's JSON result).
terminal("pay", "mm x402 pay http://127.0.0.1:4020/reports/market-data",
         "Clean seller → paid and settled",
         "Intercepta rates the payee clean; MetaMask signs; settled on Base Sepolia",
         [f'<span class="ok">settled</span>  <span class="link">sepolia.basescan.org/tx/{tx[:10]}…{tx[-6:]}</span>',
          f'<span class="dim">report: {html.escape(pay["resource"]["report"])}</span>'])
terminal("refuse", "mm x402 pay http://127.0.0.1:4020/reports/whale-alerts",
         "Sanctioned payee → refused before signing",
         "payTo is the Lazarus Group wallet (OFAC). Nothing is signed; a refusal can't be overridden")
ask = terminal("ask", "mm x402 pay http://127.0.0.1:4020/reports/alpha-signals",
               "Mixer-exposed payee → the human decides",
               "8 Tornado Cash deposits: caution tier, and $0.50 is over its $0.10 auto-pay ceiling",
               [f'<span class="dim">needs_approval · approval code {ask_code}</span>'
                for ask_code in [json.loads((SRC / "ask.txt").read_text().partition("__JSON__")[2])["approvalCode"]]])

# The gap: what an unguarded Guard Mode wallet signed (gap-test results, funded wallet on Base mainnet).
rows = [
    ("2.4 USDC (96% of balance) → Tornado Cash router", "signed", "yes"),
    ("0.01 USDC → OFAC-sanctioned Lazarus wallet", "signed", "no, frozen by Circle"),
    ('lookalike "USD Coin", one hex digit off real USDC', "signed", "n/a"),
    ("authorization valid for 1 year", "signed", "not simulated (wallet unfunded then)"),
]
trs = "".join(f"<tr><td>{html.escape(a)}</td><td class=bad>{b}</td><td>{html.escape(c)}</td></tr>" for a, b, c in rows)
page("gap", 1280, 720, f"""
<div style="padding:48px 60px">
  <div style="font-size:34px;font-weight:700;letter-spacing:-.5px">The gap: x402 payments are signatures, and nobody screens the payee</div>
  <div style="font-size:19px;color:#8b98a9;margin-top:8px">MetaMask Agent Wallet in Guard Mode on Base, before x402-guard. No 2FA prompt on any of these.</div>
  <table>
    <tr><th>x402 payment requested</th><th>Wallet</th><th>Would it settle? (eth_call)</th></tr>{trs}
  </table>
</div>""", """
table{width:100%;border-collapse:collapse;margin-top:34px;font-size:21px}
th{text-align:left;color:#8b98a9;font-weight:600;font-size:16px;text-transform:uppercase;letter-spacing:.6px;padding:0 0 12px}
td{padding:17px 0;border-top:1px solid #1f2a3a}.bad{color:#f87171;font-weight:700}
""")
print("built", sorted(p.name for p in SRC.glob("*.html")))
