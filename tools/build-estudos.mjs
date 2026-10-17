#!/usr/bin/env node
/**
 * Gera as páginas de estudo (ajuste-NN.html) a partir de:
 *   - script.js  -> array AJUSTES (resumo, contexto, mudanças, impacto, obrigações, atenção, vigência, memorizar, quiz)
 *   - CONFAZ     -> teor oficial de cada ajuste (ementa, publicação/despacho, texto das cláusulas)
 *
 * Uso:
 *   node tools/build-estudos.mjs fetch   # baixa e salva tools/estudos-oficiais.json
 *   node tools/build-estudos.mjs build   # gera ajuste-02.html .. ajuste-40.html
 *   node tools/build-estudos.mjs build --de 1   # também regenera o 01
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OFICIAIS = path.join(ROOT, "tools", "estudos-oficiais.json");
const BASE = "https://www.confaz.fazenda.gov.br";
const LISTA = BASE + "/legislacao/ajustes/2026/2026";

const args = process.argv.slice(2);
const cmd = args[0] || "build";
const getArg = (n, d) => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

/* ------------------------------------------------------------------ utils */
function strip(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, "\n")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&atilde;/g, "ã").replace(/&ccedil;/g, "ç").replace(/&ocirc;/g, "ô")
    .replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í")
    .replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&auml;/g, "ä")
    .replace(/&ecirc;/g, "ê").replace(/&otilde;/g, "õ").replace(/&#39;|&apos;/g, "'")
    .replace(/&ordm;/g, "º").replace(/&ordf;/g, "ª").replace(/&sect;/g, "§")
    .replace(/&ldquo;|&rdquo;|&bdquo;/g, '"').replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .split("\n").map(s => s.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const pad = n => String(n).padStart(2, "0");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadDataset() {
  const src = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");
  const m = src.match(/const\s+AJUSTES\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("Não achei o array AJUSTES em script.js");
  // eslint-disable-next-line no-eval
  return eval(m[1]);
}
const CATS = { nfe: "NF-e", transporte: "Transporte", varejo: "Varejo / NFC-e", energia: "Energia / Comunicação / Gás", especiais: "Especiais / Agro", fisco: "Fisco / Obrigações" };

/* --------------------------------------------------------- FETCH oficial */
async function mapUrls() {
  const map = {};
  try {
    const r = await fetch(LISTA, { headers: { "user-agent": "Mozilla/5.0 (estudos sincronizacao)" } });
    const html = await r.text();
    for (const mm of html.matchAll(/href="([^"]*\/legislacao\/ajustes\/2026\/[^"]+)"/gi)) {
      const href = mm[1];
      const n = href.match(/_?0?(\d{1,2})_26/i);
      if (n && !/retific/i.test(href)) {
        const num = +n[1];
        if (num >= 1 && num <= 40 && !map[num]) map[num] = href.startsWith("http") ? href : BASE + href;
      }
    }
  } catch (e) {
    console.warn("Aviso: falha ao ler a lista do CONFAZ:", e.message);
  }
  return map;
}

function parseOficial(html, num) {
  const text = strip(html);
  const lines = text.split("\n");
  const head = new RegExp("^AJUSTE SINIEF\\s+0?" + num + "/26$");
  // o menu lateral lista 01..40; o H1 real do ajuste é a ÚLTIMA ocorrência
  let iHead = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (head.test(lines[i])) { iHead = i; break; }
  const iImp = lines.findIndex((l, i) => i > iHead && l === "Imprimir");
  if (iHead < 0 || iImp < 0) return { ementa: "", teor: "", publicacao: "", despacho: "" };
  const ementa = lines.slice(iHead + 1, iImp).filter(l => !/^(Tweet|Info|Imprimir)$/i.test(l)).join(" ");
  let corpo = lines.slice(iImp + 1);
  const cut = corpo.findIndex(l => /^(Voltar para o topo|Compartilhe|Tweet|Este texto não substitui|Desenvolvido com o CMS|Copyright)/i.test(l));
  if (cut > 0) corpo = corpo.slice(0, cut);
  const teor = corpo.join("\n");
  let ementaFinal = ementa;
  if (!ementaFinal) {
    const cand = teor.split("\n").filter(l =>
      !/^(AJUSTE SINIEF N|Publicado no DOU|Despacho|CONFAZ|O Conselho Nacional|Ementa|\d+(\s*\/\s*\d+)?\s*\.?$)/i.test(l) && l.length > 30);
    ementaFinal = cand.length ? cand[0] : "";
  }
  const pubM = teor.match(/DOU\s+de\s+([0-9]{2}[.\/][0-9]{2}[.\/][0-9]{2,4})/i);
  const despM = teor.match(/Despacho\s+([0-9]+)\/?([0-9]*)/i);
  return {
    ementa: ementaFinal,
    teor,
    publicacao: pubM ? pubM[1] : "",
    despacho: despM ? despM[1] : "",
  };
}

async function doFetch() {
  const datas = loadDataset();
  const urls = await mapUrls();
  const out = {};
  const fila = datas.map(a => a.num);
  const conc = 4;
  let idx = 0;
  async function worker() {
    while (idx < fila.length) {
      const num = fila[idx++];
      const url = urls[num] || `${BASE}/legislacao/ajustes/2026/AJ0${pad(num)}_26`;
      try {
        const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (estudos sincronizacao)" } });
        if (!r.ok) { out[num] = { url, erro: "HTTP " + r.status }; continue; }
        const info = parseOficial(await r.text(), num);
        out[num] = { url, ...info };
        process.stdout.write(`ok ${pad(num)} (${info.ementa ? "ementa" : "SEM ementa"}) | `);
      } catch (e) {
        out[num] = { url, erro: e.message };
        process.stdout.write(`erro ${pad(num)}: ${e.message} | `);
      }
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  fs.writeFileSync(OFICIAIS, JSON.stringify(out, null, 1));
  const falhas = Object.entries(out).filter(([, v]) => v.erro || !v.ementa).map(([k]) => k);
  console.log(`\nSalvo em ${path.relative(ROOT, OFICIAIS)} (${Object.keys(out).length} ajustes).`);
  if (falhas.length) console.log("Atenção (sem ementa/erro):", falhas.join(", "));
}

/* ---------------------------------------------------------------- BUILD */
const CSS_EXTRA = `  /* blocos só das páginas de estudo — não alteram o resto do site */
  .badges{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
  .badges span{background:rgba(255,255,255,.08);border:1px solid var(--line-dark);color:#e6edf8;font-weight:700;font-size:.82rem;padding:6px 12px;border-radius:99px}
  .quote{background:#f6f8fc;border:1px solid var(--line);border-left:5px solid var(--brand);border-radius:10px;padding:14px 16px;margin:12px 0;color:#1c2a45;font-size:1rem;white-space:pre-wrap}
  .quote .src{display:block;margin-top:8px;color:var(--muted-card);font-size:.82rem;font-weight:700;white-space:normal}
  .callout{border-radius:12px;padding:14px 16px;margin:14px 0;border:1px solid var(--line);color:var(--ink-card);background:var(--card)}
  .callout h4{margin:0 0 6px;color:var(--brand)}
  .callout.tip{background:var(--ok-bg);border-color:var(--ok-border);color:var(--ok-ink)}
  .callout.tip h4{color:var(--ok-ink)}
  .callout.warn2{background:#fff7ed;border-color:#fed7aa;color:#7c2d12}
  .callout.warn2 h4{color:#9a3412}
  .steps{counter-reset:s;list-style:none;padding:0;margin:12px 0}
  .steps li{counter-increment:s;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px 12px 52px;position:relative;margin:8px 0;color:var(--ink-card);box-shadow:var(--shadow-card)}
  .steps li::before{content:counter(s);position:absolute;left:12px;top:12px;width:26px;height:26px;border-radius:99px;background:var(--brand);color:#fff;font-weight:800;display:grid;place-items:center;font-size:.85rem}
  .check{list-style:none;padding:0;margin:10px 0}
  .check li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:6px 0;color:var(--ink-card);box-shadow:var(--shadow-card)}
  .check li::before{content:"☐ ";color:var(--brand);font-weight:800}
  .toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px;box-shadow:var(--shadow-card);color:var(--ink-card);margin:14px 0}
  .toc a{color:var(--brand);text-decoration:none;font-weight:600;display:inline-block;margin:3px 14px 3px 0}
  details.nota{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:6px 14px;margin:12px 0;color:var(--ink-card);box-shadow:var(--shadow-card)}
  details.nota summary{cursor:pointer;font-weight:700;padding:8px 0;color:var(--brand)}
  details.nota .teor{white-space:pre-wrap;font-size:.93rem;line-height:1.55;color:#33415c}
  .cta-row{display:flex;gap:10px;flex-wrap:wrap;margin:14px 0}
  .reading{max-width:78ch}
  .pill{display:inline-block;background:var(--chip);color:var(--chip-ink);font-weight:700;font-size:.78rem;padding:3px 10px;border-radius:99px;margin:0 6px 6px 0}
`;

function lista(arr, cls) {
  if (!arr || !arr.length) return "";
  return `<ul${cls ? ` class="${cls}"` : ""}>` + arr.map(t => `<li>${t}</li>`).join("") + `</ul>`;
}

function pageHTML(a, oficial) {
  const n2 = pad(a.num);
  const cat = CATS[a.cat] || a.cat;
  const url = (oficial && oficial.url) || `${BASE}/legislacao/ajustes/2026/AJ0${n2}_26`;
  const ementa = (oficial && oficial.ementa) || a.ementa || a.resumo;
  const pub = oficial && oficial.publicacao ? `DOU ${oficial.publicacao}` : "";
  const desp = oficial && oficial.despacho ? `Despacho ${oficial.despacho}/26` : "";
  const teor = (oficial && oficial.teor) || "";
  const titulo = `Ajuste SINIEF ${a.num}/2026 — Estudo (${a.titulo})`;
  const desc = (a.resumo || "").replace(/"/g, "'");

  const mudancas = lista(a.mudancas, "steps");
  const impacto = lista(a.impacto);
  const obrig = lista(a.obrigacoes, "check");
  const atencao = lista(a.atencao);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(titulo)}</title>
<meta name="description" content="Estudo do Ajuste SINIEF ${a.num}/2026: ${esc(desc)}">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="stylesheet" href="styles.css?v=20261018">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%230F2A44'/%3E%3Ctext x='16' y='22' font-family='Arial' font-size='15' font-weight='bold' fill='white' text-anchor='middle'%3ESN%3C/text%3E%3C/svg%3E">
<style>
${CSS_EXTRA}</style>
</head>
<body>
<a class="skip" href="#conteudo">Pular para o conteúdo</a>

<header class="topbar">
  <div class="wrap topbar-inner">
    <div class="brand">
      <span class="brand-badge">SINIEF 2026</span>
      <div><strong>Estudo do Ajuste ${n2}/2026</strong><small>Leitura guiada · ${esc(a.tag)}</small></div>
    </div>
    <nav class="nav" aria-label="Navegação">
      <a href="index.html">← Portal 01-40/2026</a>
      <a href="#muda">Entenda</a>
      <a href="#teor">Teor oficial</a>
      <a href="#quiz">Quiz</a>
      <a href="${esc(url)}" target="_blank" rel="noopener">Oficial ↗</a>
    </nav>
    <div class="top-actions">
      <button id="themeBtn" class="btn ghost" type="button">◐ Tema</button>
      <button id="printBtn" class="btn ghost" type="button">⎙ PDF</button>
    </div>
  </div>
</header>

<main id="conteudo">
  <section class="hero wrap">
    <div class="hero-grid">
      <div>
        <p class="kicker">Ajuste SINIEF ${n2}/2026 · ${esc(cat)}${desp ? " · " + esc(desp) : ""}</p>
        <h1>Ajuste SINIEF <span class="hl">${a.num}/2026</span></h1>
        <p class="lead">${esc(a.resumo)}</p>
        <div class="badges" role="list">
          <span role="listitem">${esc(a.tag)}</span>
          <span role="listitem">${esc(cat)}</span>
          ${a.vigencia ? `<span role="listitem">${esc(a.vigencia)}</span>` : ""}
            ${pub ? `<span role="listitem">Publicação ${esc(pub)}</span>` : ""}
        </div>
        <div class="cta-row">
          <a class="btn primary" href="#muda">Começar a leitura →</a>
          <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Texto oficial CONFAZ ↗</a>
        </div>
      </div>
      <aside class="hero-card">
        <h2>Em 30 segundos</h2>
        <p><strong>O que é:</strong> ${esc(a.resumo)}</p>
        <p><strong>Vigência:</strong> ${esc(a.vigencia || "conferir no CONFAZ")}.</p>
        <p><strong>Para memorizar:</strong> ${esc(a.memorizar || "")}</p>
        <p class="warn">⚠️ <strong>Didático.</strong> Vale sempre o texto oficial no CONFAZ/DOU.</p>
      </aside>
    </div>
  </section>

  <div class="wrap">
    <nav class="toc" aria-label="Nesta página">
      <strong>Nesta página:</strong>
      <a href="#muda">1. O que muda</a>
      <a href="#ficha">2. Ficha técnica</a>
      <a href="#contexto">3. Contexto</a>
      <a href="#dispoe">4. O que o ajuste dispõe</a>
      <a href="#quem">5. Quem é afetado</a>
      <a href="#fazer">6. O que fazer</a>
      <a href="#atencao">7. Pontos de atenção</a>
      <a href="#teor">8. Teor oficial</a>
      <a href="#quiz">9. Quiz</a>
      <a href="#fontes">10. Fontes</a>
    </nav>
  </div>

  <section id="muda" class="wrap reading">
    <h2 class="section-title">1. O que muda, em uma frase</h2>
    <div class="detail">
      <p>${esc(a.resumo)}</p>
      ${a.memorizar ? `<p class="memo">🧠 <strong>Memorize:</strong> ${esc(a.memorizar)}</p>` : ""}
      ${a.ementa ? `<p>${esc(a.ementa)}</p>` : ""}
    </div>
  </section>

  <section id="ficha" class="wrap">
    <h2 class="section-title">2. Ficha técnica</h2>
    <div class="table-wrap">
      <table>
        <tbody>
          <tr><th style="width:230px">Ato</th><td>Ajuste SINIEF nº ${a.num}, de 2026</td></tr>
          <tr><th>Tema</th><td>${esc(a.tag)}</td></tr>
          <tr><th>Categoria</th><td>${esc(cat)}</td></tr>
          <tr><th>Ementa</th><td>${esc(ementa)}</td></tr>
          ${pub || desp ? `<tr><th>Publicação</th><td>${esc(pub)}${pub && desp ? " · " : ""}${esc(desp)}</td></tr>` : ""}
          <tr><th>Vigência</th><td>${esc(a.vigencia || "conferir no CONFAZ")}</td></tr>
          <tr><th>Fonte oficial</th><td><a href="${esc(url)}" target="_blank" rel="noopener">CONFAZ — Ajuste SINIEF ${n2}/26 ↗</a></td></tr>
        </tbody>
      </table>
    </div>
  </section>

  <section id="contexto" class="wrap reading">
    <h2 class="section-title">3. Contexto</h2>
    <div class="detail"><p>${esc(a.contexto)}</p></div>
  </section>

  <section id="dispoe" class="wrap reading">
    <h2 class="section-title">4. O que o ajuste dispõe</h2>
    <p class="muted">Resumo didático dos pontos principais. O texto literal está na seção 8.</p>
    ${mudancas}
  </section>

  <section id="quem" class="wrap two-col">
    <div>
      <h2 class="section-title">5. Quem é afetado</h2>
      <div class="card static"><ul style="margin:6px 0 0;padding-left:18px;color:#33415c">${(a.impacto || []).map(t => `<li>${t}</li>`).join("")}</ul></div>
    </div>
    <div id="fazer">
      <h2 class="section-title">6. O que fazer</h2>
      ${obrig || '<p class="muted">Sem ação específica registrada.</p>'}
    </div>
  </section>

  <section id="atencao" class="wrap reading">
    <h2 class="section-title">7. Pontos de atenção</h2>
    <div class="callout warn2">
      <h4>⚠️ Não caia nessas</h4>
      ${atencao || "<p>Sem alerta específico registrado.</p>"}
    </div>
  </section>

  <section id="teor" class="wrap reading">
    <h2 class="section-title">8. Teor oficial</h2>
    <div class="detail">
      ${ementa ? `<blockquote class="quote">“${esc(ementa)}”<span class="src">Ementa — Ajuste SINIEF ${n2}/2026 (CONFAZ)</span></blockquote>` : ""}
      ${teor ? `<details class="nota">
        <summary>Ver o texto integral publicado no CONFAZ (para conferência)</summary>
        <div class="teor">${esc(teor)}</div>
        <p class="muted">Fonte: <a href="${esc(url)}" target="_blank" rel="noopener">CONFAZ — Ajuste SINIEF ${n2}/26 ↗</a>. Confira sempre o original.</p>
      </details>` : `<p class="muted">Abra o <a href="${esc(url)}" target="_blank" rel="noopener">texto oficial no CONFAZ ↗</a> para o teor integral.</p>`}
    </div>
  </section>

  <section id="quiz" class="wrap">
    <h2 class="section-title">9. Quiz rápido</h2>
    <p class="muted">Corrige na hora, salvo no navegador.</p>
    <div id="quizBox"></div>
    <div class="quiz-head" style="color:#fff">
      <div class="bar"><div id="quizBar" style="width:0%"></div></div>
      <p><span id="quizScore">0</span> / <span id="quizTotal">1</span></p>
      <button class="btn small" id="quizReset" type="button">Reiniciar</button>
    </div>
  </section>

  <section id="fontes" class="wrap reading">
    <h2 class="section-title">10. Fontes</h2>
    <div class="detail">
      <p><strong>Oficial:</strong> <a href="${esc(url)}" target="_blank" rel="noopener">Ajuste SINIEF ${n2}/2026 ↗</a> · <a href="${BASE}/legislacao/ajustes/2026/2026" target="_blank" rel="noopener">Ajustes SINIEF 2026 ↗</a>${pub ? ` · ${esc(pub)}${desp ? " (" + esc(desp) + ")" : ""}` : ""}.</p>
      <p><strong>Citar:</strong> <em>Estudo do Ajuste SINIEF ${a.num}/2026. Didático, sem valor normativo. Out/2026.</em></p>
      <p><a class="btn small" href="index.html">← Voltar ao portal 01-40/2026</a></p>
    </div>
  </section>
</main>

<footer>
  <div class="wrap foot">
    <p><strong>Ajuste SINIEF ${a.num}/2026</strong> — página de estudo. Estático, sem backend.</p>
    <p class="muted">Divergência: vale CONFAZ/DOU.</p>
    <p class="foot-links"><a href="index.html" style="color:#93a3bf;margin-right:12px">Portal 01-40/2026</a><a href="#conteudo" style="color:#93a3bf">↑ Topo</a></p>
  </div>
</footer>

<button id="topBtn" title="Topo" type="button">↑</button>

<script>
(function(){
  try{var t=localStorage.getItem("sinief_theme");if(t)document.documentElement.setAttribute("data-theme",t);}catch(e){}
  var themeBtn=document.getElementById("themeBtn");
  if(themeBtn)themeBtn.onclick=function(){var h=document.documentElement;var cur=h.getAttribute("data-theme")==="light"?"dark":"light";h.setAttribute("data-theme",cur);try{localStorage.setItem("sinief_theme",cur);}catch(e){}};
  var printBtn=document.getElementById("printBtn");
  if(printBtn)printBtn.onclick=function(){window.print();};
  var top=document.getElementById("topBtn");
  addEventListener("scroll",function(){top.style.display=scrollY>600?"block":"none";});
  top.onclick=function(){scrollTo({top:0,behavior:"smooth"});};

  var QS=[${JSON.stringify(a.quiz)}];
  var LS="ajuste${n2}_quiz";
  function getA(){try{return JSON.parse(localStorage.getItem(LS)||"{}");}catch(e){return{};}}
  function setA(o){try{localStorage.setItem(LS,JSON.stringify(o));}catch(e){}}
  var box=document.getElementById("quizBox");
  function render(){
    var ans=getA();
    box.innerHTML=QS.map(function(item,i){
      var v=ans[i];var cls=v===undefined?"":(v.ok?"ok":"err");
      return '<div class="q '+cls+'"><p>'+(i+1)+'. '+item.q+'</p>'+
        item.opts.map(function(o,j){
          return '<label><input type="radio" name="q'+i+'" value="'+j+'" '+(v!==undefined&&v.pick===j?"checked":"")+' '+(v!==undefined?"disabled":"")+'> '+String.fromCharCode(65+j)+') '+o+'</label>';
        }).join("")+
        (v===undefined?'<button class="btn small" data-a="'+i+'">Responder</button>':'<p class="fb">'+(v.ok?"✅ Correta!":"❌ Incorreta.")+' '+item.exp+'</p>')+
      '</div>';
    }).join("");
    box.querySelectorAll("[data-a]").forEach(function(b){
      b.onclick=function(){
        var i=+b.dataset.a;var sel=box.querySelector('input[name=q'+i+']:checked');
        if(!sel){alert("Escolha uma alternativa.");return;}
        var pick=+sel.value;var cur=getA();cur[i]={ok:pick===QS[i].a,pick:pick};setA(cur);render();upd();
      };
    });
    upd();
  }
  function upd(){
    var ans=getA();var c=0;for(var k in ans){if(ans[k]&&ans[k].ok)c++;}
    document.getElementById("quizScore").textContent=c;
    document.getElementById("quizTotal").textContent=QS.length;
    document.getElementById("quizBar").style.width=Math.round(c/QS.length*100)+"%";
  }
  document.getElementById("quizReset").onclick=function(){setA({});render();};
  render();
})();
</script>
</body>
</html>
`.replace(/href="styles\.css\?v=20261018"/g, 'href="styles.css?v=20261018"');
}

function doBuild() {
  const datas = loadDataset();
  const oficial = fs.existsSync(OFICIAIS) ? JSON.parse(fs.readFileSync(OFICIAIS, "utf8")) : {};
  const de = Math.max(1, +getArg("de", 2));
  let n = 0;
  for (const a of datas) {
    if (a.num < de) continue;
    const html = pageHTML(a, oficial[a.num]);
    fs.writeFileSync(path.join(ROOT, `ajuste-${pad(a.num)}.html`), html);
    n++;
  }
  console.log(`Geradas ${n} páginas (ajuste-${pad(de)}.html .. ajuste-${pad(datas[datas.length - 1].num)}.html).`);
}

if (cmd === "fetch") await doFetch();
else doBuild();
