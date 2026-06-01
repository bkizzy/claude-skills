#!/usr/bin/env python3
"""
Render the RFP evaluation HTML report from a compact JSON file.

The point: keep the big, repetitive HTML/CSS out of the model's output. The skill
emits a small JSON of findings; this script wraps it in the styled, self-contained
report. That's the main speed lever on the write side.

Usage:  python3 render_report.py <eval.json> <output.html>

See SKILL.md step 5 for the JSON schema. Text fields are plain text (escaped here);
use **double asterisks** for bold. Fields ending in _html are passed through as-is.
Role is "recipient" (bid view) or "issuer" (improve-my-RFP view).
"""
import sys, os, json, re, html

def fmt(s):
    """Escape a plain-text field and convert **bold** to <b>…</b>."""
    if s is None:
        return ""
    s = html.escape(str(s), quote=False)
    s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
    return s

def cite(c):
    return f' <span class="cite">({fmt(c)})</span>' if c else ""

CSS = """
  :root{--green:#1a7f4b;--green-bg:#e6f4ec;--yellow:#b8860b;--yellow-bg:#fbf3e0;
  --red:#c0392b;--red-bg:#fbeae8;--ink:#1c2430;--muted:#5b6776;--line:#e3e8ee;--bg:#f6f8fa;--card:#fff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .wrap{max-width:920px;margin:0 auto;padding:32px 24px 80px}
  .copybtn{position:fixed;top:16px;right:16px;z-index:10;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
  .copybtn:hover{background:var(--bg)}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:19px;margin:34px 0 12px;padding-bottom:6px;border-bottom:2px solid var(--line)}
  h3{font-size:15px;margin:18px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
  .sub{color:var(--muted);margin:0 0 20px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:14px 0}
  .scorehead{display:flex;gap:24px;align-items:center;flex-wrap:wrap}
  .scoreball{width:128px;height:128px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;flex:0 0 auto}
  .scoreball .n{font-size:44px;font-weight:700;line-height:1} .scoreball .l{font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.9}
  .bg-green{background:var(--green)} .bg-yellow{background:var(--yellow)} .bg-red{background:var(--red)}
  .verdict{flex:1;min-width:240px} .verdict .call{font-size:22px;font-weight:700;margin:0 0 4px}
  .pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}
  .pill.green{background:var(--green-bg);color:var(--green)} .pill.yellow{background:var(--yellow-bg);color:var(--yellow)} .pill.red{background:var(--red-bg);color:var(--red)}
  .meta{display:flex;gap:24px;flex-wrap:wrap;margin-top:10px;font-size:14px;color:var(--muted)} .meta b{color:var(--ink)}
  .flag{border-left:4px solid var(--red);background:var(--red-bg);padding:10px 14px;border-radius:0 8px 8px 0;margin:8px 0}
  .flag.yellow{border-color:var(--yellow);background:var(--yellow-bg)} .flag.green{border-color:var(--green);background:var(--green-bg)}
  .flag .t{font-weight:600} .flag .i{font-size:14px;color:var(--muted)}
  table{width:100%;border-collapse:collapse;font-size:14px}
  th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
  .dot.green{background:var(--green)} .dot.yellow{background:var(--yellow)} .dot.red{background:var(--red)}
  .totalrow td{font-weight:700;border-top:2px solid var(--line);border-bottom:none}
  .gateline{font-size:14px;color:var(--red);margin-top:8px}
  ul{margin:6px 0;padding-left:20px} li{margin:3px 0}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px} @media(max-width:680px){.grid2{grid-template-columns:1fr}}
  .xray .one{font-weight:600;margin:14px 0 2px} .xray .one:first-child{margin-top:0}
  .cite{color:var(--muted);font-size:13px}
  footer{margin-top:40px;color:var(--muted);font-size:12px;text-align:center}
"""

COPY_JS = """
function copyDoc(){var el=document.getElementById('doc');var r=document.createRange();r.selectNode(el);
var s=window.getSelection();s.removeAllRanges();s.addRange(r);
try{document.execCommand('copy');var b=document.querySelector('.copybtn');var t=b.textContent;b.textContent='Copied!';setTimeout(function(){b.textContent=t;},1500);}
catch(e){alert('Press Cmd/Ctrl+C to copy');}s.removeAllRanges();}
"""

def render_flags(flags):
    out = []
    for f in flags or []:
        lvl = f.get("level", "red")
        cls = "flag" if lvl == "red" else f"flag {lvl}"
        out.append(f'<div class="{cls}"><div class="t">{fmt(f.get("title"))}</div>'
                   f'<div class="i">{fmt(f.get("impact"))}{cite(f.get("cite"))}</div></div>')
    return "\n".join(out)

def render_criteria(criteria):
    rows = []
    for c in criteria or []:
        rows.append(
            f'<tr><td><span class="dot {c.get("flag","yellow")}"></span>{fmt(c.get("name"))}</td>'
            f'<td class="num">{fmt(c.get("score"))}</td><td class="num">{fmt(c.get("weight"))}%</td>'
            f'<td class="num">{fmt(c.get("contribution"))}</td>'
            f'<td>{fmt(c.get("rationale"))}{cite(c.get("cite"))}</td></tr>')
    return "\n".join(rows)

def render_scope_groups(groups):
    cards = []
    for g in groups or []:
        items = "".join(f"<li>{fmt(i)}</li>" for i in g.get("items", []))
        cards.append(f'<div><b>{fmt(g.get("label"))}</b><ul>{items}</ul></div>')
    return f'<div class="card grid2">{"".join(cards)}</div>' if cards else ""

def render_xray(xray, assessment):
    parts = []
    for x in xray or []:
        parts.append(f'<p class="one">{fmt(x.get("name"))} — {fmt(x.get("one_line"))}</p>'
                     f'<p>{fmt(x.get("details"))}{cite(x.get("cite"))}</p>')
    if assessment:
        parts.append('<hr style="border:none;border-top:1px solid var(--line);margin:14px 0">'
                     f'<p class="one">Current assessment</p><p>{fmt(assessment)}</p>')
    return f'<div class="card xray">{"".join(parts)}</div>' if parts else ""

def render_list(items):
    return "<ul>" + "".join(f"<li>{fmt(i)}</li>" for i in (items or [])) + "</ul>"

def main():
    if len(sys.argv) < 3:
        print("Usage: render_report.py <eval.json> <output.html>", file=sys.stderr)
        sys.exit(1)
    d = json.load(open(sys.argv[1]))
    role = d.get("role", "recipient")

    meta = "".join(f'<span><b>{fmt(k)}:</b> {fmt(v)}</span>' for k, v in d.get("meta", []))
    pills = f'<span class="pill {d.get("color","red")}">{fmt(d.get("score_label", d.get("color","").title()))}</span>'
    if d.get("quality_label"):
        pills += f' &nbsp; <span class="pill {d.get("quality_color","yellow")}">{fmt(d["quality_label"])}</span>'

    body = []
    # Header score card
    body.append(f'''<div class="card scorehead">
    <div class="scoreball bg-{d.get("color","red")}"><div class="n">{fmt(d.get("score"))}</div><div class="l">{fmt(d.get("color","").title())}</div></div>
    <div class="verdict"><p class="call">{fmt(d.get("call"))}</p>{pills}
    <p style="margin:10px 0 0">{fmt(d.get("verdict"))}</p>
    <div class="meta">{meta}</div></div></div>''')

    # Red flags
    if d.get("flags"):
        body.append("<h2>Red flags &amp; dealbreakers</h2>")
        body.append(render_flags(d["flags"]))
    if d.get("gate_line"):
        body.append(f'<p class="gateline">{fmt(d["gate_line"])}</p>')

    # Score breakdown
    body.append("<h2>Score breakdown</h2>")
    if d.get("weights_note"):
        body.append(f'<p class="sub" style="margin:-4px 0 10px">{fmt(d["weights_note"])}</p>')
    tr = d.get("total_row", {})
    body.append(f'''<div class="card"><table>
    <thead><tr><th>Criterion</th><th class="num">Score</th><th class="num">Weight</th><th class="num">Contribution</th><th>Rationale (evidence)</th></tr></thead>
    <tbody>{render_criteria(d.get("criteria"))}
    <tr class="totalrow"><td>{fmt(tr.get("label","Weighted total"))}</td><td class="num">{fmt(tr.get("score"))}</td><td class="num">100%</td><td class="num"></td><td>{fmt(tr.get("note"))}</td></tr>
    </tbody></table></div>''')

    # Charts & figures read
    if d.get("charts_note"):
        body.append("<h2>Charts &amp; figures read</h2>")
        body.append(f'<div class="card"><p style="margin:0">{fmt(d["charts_note"])}</p></div>')

    # Role-specific body
    view_title = "Agency view — should we respond?" if role == "recipient" else "Issuer view — how to improve this RFP"
    body.append(f"<h2>{view_title}</h2>")
    if d.get("background"):
        body.append(f"<h3>Background</h3><p>{fmt(d['background'])}</p>")
    if d.get("scope_groups"):
        body.append("<h3>Scope of work</h3>" + render_scope_groups(d["scope_groups"]))
    if d.get("key_dates"):
        body.append("<h3>Key dates</h3>" + render_list(d["key_dates"]))
    if d.get("xray"):
        body.append("<h3>RFP X-Ray</h3>" + render_xray(d["xray"], d.get("current_assessment")))

    if role == "recipient":
        if d.get("recommendation"):
            body.append(f"<h3>Recommendation</h3><p>{fmt(d['recommendation'])}</p>")
        if d.get("clarifications"):
            body.append("<p><b>Clarifications to request before bidding:</b></p>" + render_list(d["clarifications"]))
    else:
        if d.get("feedback_table"):
            rows = "".join(
                f'<tr><td>{fmt(r.get("area"))}</td><td><span class="dot {r.get("status_color","yellow")}"></span>{fmt(r.get("status"))}</td><td>{fmt(r.get("feedback"))}</td></tr>'
                for r in d["feedback_table"])
            body.append(f'<div class="card"><table><thead><tr><th>Area</th><th>Status</th><th>Feedback</th></tr></thead><tbody>{rows}</tbody></table></div>')
        if d.get("priority_fixes"):
            body.append("<h3>Priority fixes</h3>" + render_list(d["priority_fixes"]))
        if d.get("narrative"):
            body.append(f"<h3>Narrative</h3><p>{fmt(d['narrative'])}</p>")

    body.append(f'<footer>{fmt(d.get("footer","Generated by the rfp-evaluator skill · Scores are decision support, not a substitute for legal/financial review."))}</footer>')

    doc = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>RFP Evaluation — {fmt(d.get("title"))}</title><style>{CSS}</style></head>
<body><button class="copybtn" onclick="copyDoc()">Copy report</button>
<div class="wrap" id="doc">
<h1>{fmt(d.get("title"))}</h1>
<p class="sub">{fmt(d.get("client_line"))}</p>
{"".join(body)}
</div><script>{COPY_JS}</script></body></html>'''

    out_path = sys.argv[2]
    with open(out_path, "w") as f:
        f.write(doc)
    print(json.dumps({"ok": True, "output": out_path, "bytes": len(doc)}))

if __name__ == "__main__":
    main()
