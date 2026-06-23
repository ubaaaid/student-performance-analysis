/* ════════════════════════════════════════════════════════════════════════
   REGISTRAR — Student Performance Analysis (full-stack, single file)

   A complete app in one file:
     • Express HTTP server + REST API
     • Persistent SQLite database (built-in node:sqlite), seeded on first run,
       with a graceful in-memory fallback on older Node versions
     • Server-side analytics + an explainable risk-scoring model
     • A self-contained frontend (HTML + Chart.js) served at /

   RUN:
     npm init -y && npm install express
     node server.js
     → open http://localhost:3000

   (Node 22+ recommended for built-in SQLite persistence. On older Node the
    app still runs fully using an in-memory store; data resets on restart.)
   ════════════════════════════════════════════════════════════════════════ */

const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, "registrar.db");

/* ───────────────────────── DOMAIN: seed data ───────────────────────── */
const CLASSES = ["Algebra II", "Biology 201", "World History", "CS Fundamentals", "English Lit", "Chemistry"];
const EDU = ["No diploma", "High school", "Some college", "Bachelor's", "Graduate"];
const FIRST = ["Maya","Liam","Aisha","Noah","Sofia","Ethan","Zara","Lucas","Priya","Mateo","Chloe","Omar","Ava","Kai","Isla","Diego","Nina","Ryan","Leila","Jonas","Tara","Felix","Amara","Theo","Yuki","Marcus","Elena","Sam","Hana","Caleb","Rosa","Ivan","Mei","Dario","Anya","Cole","Layla","Finn","Gita","Pablo","Nora","Reza","Tess","Hugo","Ines","Kofi","Lina","Otis","Suri","Vance"];
const LAST = ["Okafor","Nguyen","Patel","Silva","Cohen","Reyes","Haddad","Kim","Mbeki","Rossi","Andersson","Khan","Dubois","Tanaka","Oduya","Costa","Larsen","Mensah","Vargas","Petrov","Brandt","Sato","Ali","Novak","Ferreira","Owens","Bauer","Ito","Sharma","Lindqvist","Diallo","Gomez","Fischer","Park","Romano","Abara","Holt","Marek","Lund","Yusuf","Cruz","Bergstrom","Naidoo","Schulz","Banda","Moretti","Eze","Saito","Toure"];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateCohort() {
  const rnd = mulberry32(20260621);
  const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 1.5;
  const rows = [];
  for (let i = 0; i < 142; i++) {
    const studyHours = Math.max(0, Math.round(rnd() * 14 + gauss() * 1.5));
    const attendance = Math.min(100, Math.max(48, Math.round(86 + gauss() * 11)));
    const failures = rnd() < 0.7 ? 0 : rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : 3;
    const eduIdx = Math.min(4, Math.max(0, Math.round(rnd() * 4 + gauss() * 0.6)));
    const tutoring = rnd() < 0.28 ? 1 : 0;
    const extracurric = rnd() < 0.46 ? 1 : 0;
    const internet = rnd() < 0.86 ? 1 : 0;

    let base = 47;
    base += Math.min(studyHours, 12) * 2.0;
    base += (attendance - 78) * 0.55;
    base -= failures * 8.5;
    base += eduIdx * 2.4;
    base += tutoring ? 4.5 : 0;
    base += extracurric ? 1.5 : 0;
    base += internet ? 2.5 : -2;
    base += gauss() * 7;

    const final = Math.min(100, Math.max(8, Math.round(base)));
    const trend = Math.round(gauss() * 7 + (tutoring ? 2 : -0.5));
    const t1 = Math.min(100, Math.max(5, Math.round(final - trend * 0.85 + gauss() * 4)));
    const t2 = Math.min(100, Math.max(5, Math.round(final - trend * 0.35 + gauss() * 4)));

    rows.push({
      id: i + 1,
      name: FIRST[Math.floor(rnd() * FIRST.length)] + " " + LAST[Math.floor(rnd() * LAST.length)],
      klass: CLASSES[Math.floor(rnd() * CLASSES.length)],
      age: 15 + Math.floor(rnd() * 4),
      studyHours, attendance, failures,
      parentEdu: EDU[eduIdx], eduIdx,
      tutoring, extracurric, internet,
      t1, t2, final,
    });
  }
  return rows;
}

/* ───────────────────────── DATA LAYER (SQLite or memory) ───────────────────────── */
function makeStore() {
  const COLS = "id,name,klass,age,studyHours,attendance,failures,parentEdu,eduIdx,tutoring,extracurric,internet,t1,t2,final";
  try {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(DB_FILE);
    db.exec(`CREATE TABLE IF NOT EXISTS students(
      id INTEGER PRIMARY KEY, name TEXT, klass TEXT, age INTEGER,
      studyHours INTEGER, attendance INTEGER, failures INTEGER,
      parentEdu TEXT, eduIdx INTEGER, tutoring INTEGER, extracurric INTEGER,
      internet INTEGER, t1 INTEGER, t2 INTEGER, final INTEGER)`);

    const count = db.prepare("SELECT COUNT(*) c FROM students").get().c;
    if (count === 0) {
      const ins = db.prepare(
        `INSERT INTO students(${COLS}) VALUES(@id,@name,@klass,@age,@studyHours,@attendance,@failures,@parentEdu,@eduIdx,@tutoring,@extracurric,@internet,@t1,@t2,@final)`
      );
      for (const r of generateCohort()) ins.run(r);
      console.log("• Seeded 142 students into SQLite (" + DB_FILE + ")");
    }
    return {
      backend: "sqlite",
      all: () => db.prepare("SELECT * FROM students").all(),
      byId: (id) => db.prepare("SELECT * FROM students WHERE id=?").get(id),
      // real SQL aggregate, used to show the DB doing work:
      classAverages: () =>
        db.prepare("SELECT klass, AVG(final) avg, COUNT(*) n FROM students GROUP BY klass").all(),
    };
  } catch (e) {
    console.log("• node:sqlite unavailable (" + e.code + ") — using in-memory store. Data will not persist.");
    const rows = generateCohort();
    return {
      backend: "memory",
      all: () => rows.map((r) => ({ ...r })),
      byId: (id) => { const r = rows.find((x) => x.id === Number(id)); return r ? { ...r } : undefined; },
      classAverages: () => {
        const m = {};
        for (const r of rows) { (m[r.klass] = m[r.klass] || []).push(r.final); }
        return Object.entries(m).map(([klass, a]) => ({ klass, avg: a.reduce((x, y) => x + y, 0) / a.length, n: a.length }));
      },
    };
  }
}

/* ───────────────────────── ANALYTICS + RISK (server-side) ───────────────────────── */
const PASS = 60;
const BANDS = [
  { key: "A", min: 90 }, { key: "B", min: 80 }, { key: "C", min: 70 },
  { key: "D", min: 60 }, { key: "F", min: 0 },
];
const bandKey = (g) => (BANDS.find((b) => g >= b.min) || BANDS[BANDS.length - 1]).key;

function scoreRisk(s) {
  const factors = [];
  let score = 0;
  if (s.final < PASS) {
    const w = 22 + Math.round(((PASS - s.final) / PASS) * 45);
    score += w; factors.push({ label: "Failing grade (" + s.final + "%)", weight: w, icon: "grade" });
  }
  const drop = s.t1 - s.final;
  if (drop > 4) {
    const w = Math.min(22, Math.round(drop * 1.3));
    score += w; factors.push({ label: "Declining trend (-" + drop + " pts since Term 1)", weight: w, icon: "trend" });
  }
  if (s.attendance < 82) {
    const w = Math.min(22, Math.round((82 - s.attendance) * 1.1));
    score += w; factors.push({ label: "Low attendance (" + s.attendance + "%)", weight: w, icon: "att" });
  }
  if (s.failures > 0) {
    const w = s.failures * 6;
    score += w; factors.push({ label: s.failures + " prior course failure" + (s.failures > 1 ? "s" : ""), weight: w, icon: "fail" });
  }
  if (s.studyHours < 4) {
    const w = (4 - s.studyHours) * 3;
    score += w; factors.push({ label: "Low study time (" + s.studyHours + " hrs/wk)", weight: w, icon: "study" });
  }
  score = Math.min(100, score);
  factors.sort((a, b) => b.weight - a.weight);
  const level = score >= 50 ? "high" : score >= 22 ? "mod" : "low";
  const recs = {
    grade: "Schedule subject tutoring and a guardian check-in this week.",
    trend: "Investigate the recent drop — meet 1:1 to find what changed.",
    att: "Engage attendance counselor; address barriers to showing up.",
    fail: "Build a recovery plan with milestones and weekly review.",
    study: "Co-design a study schedule; pair with a peer study group.",
  };
  const rec = factors.length ? recs[factors[0].icon] : "On track — keep current support and reinforce strengths.";
  return { score, level, factors, rec };
}

const avg = (arr, f) => (arr.length ? arr.reduce((a, x) => a + f(x), 0) / arr.length : 0);

function overview(scoped, store) {
  const n = scoped.length;
  const a = avg(scoped, (s) => s.final);
  const passRate = n ? (scoped.filter((s) => s.final >= PASS).length / n) * 100 : 0;
  const atRisk = scoped.filter((s) => scoreRisk(s).level !== "low").length;
  const dist = ["A", "B", "C", "D", "F"].map((k) => ({
    label: k, count: scoped.filter((s) => bandKey(s.final) === k).length,
  }));
  const trend = [
    { term: "Term 1", avg: +avg(scoped, (s) => s.t1).toFixed(1) },
    { term: "Term 2", avg: +avg(scoped, (s) => s.t2).toFixed(1) },
    { term: "Final", avg: +a.toFixed(1) },
  ];
  const byClass = store.classAverages()
    .map((r) => ({ klass: r.klass, avg: +r.avg.toFixed(1), n: r.n }))
    .sort((x, y) => y.avg - x.avg);
  return { n, avg: +a.toFixed(1), passRate: +passRate.toFixed(1), atRisk, dist, trend, byClass };
}

function insights(scoped) {
  const bucket = (defs) => defs.map((d) => {
    const grp = scoped.filter(d.test);
    return { label: d.label, avg: +avg(grp, (s) => s.final).toFixed(1), n: grp.length };
  });
  return {
    study: bucket([
      { label: "0–3 h", test: (s) => s.studyHours <= 3 },
      { label: "4–7 h", test: (s) => s.studyHours >= 4 && s.studyHours <= 7 },
      { label: "8–11 h", test: (s) => s.studyHours >= 8 && s.studyHours <= 11 },
      { label: "12+ h", test: (s) => s.studyHours >= 12 },
    ]),
    att: bucket([
      { label: "<70%", test: (s) => s.attendance < 70 },
      { label: "70–79%", test: (s) => s.attendance >= 70 && s.attendance < 80 },
      { label: "80–89%", test: (s) => s.attendance >= 80 && s.attendance < 90 },
      { label: "90%+", test: (s) => s.attendance >= 90 },
    ]),
    fails: bucket([
      { label: "0", test: (s) => s.failures === 0 },
      { label: "1", test: (s) => s.failures === 1 },
      { label: "2", test: (s) => s.failures === 2 },
      { label: "3+", test: (s) => s.failures >= 3 },
    ]),
    edu: EDU.map((e) => {
      const grp = scoped.filter((s) => s.parentEdu === e);
      return { label: e, avg: +avg(grp, (s) => s.final).toFixed(1), n: grp.length };
    }),
    scatter: scoped.map((s) => ({ x: s.attendance, y: s.final, band: bandKey(s.final) })),
  };
}

/* ───────────────────────── SERVER ───────────────────────── */
const store = makeStore();
const app = express();
app.use(express.json());

const scope = (req) => {
  const klass = req.query.class;
  const all = store.all();
  return !klass || klass === "All classes" ? all : all.filter((s) => s.klass === klass);
};

app.get("/api/health", (_req, res) => res.json({ ok: true, backend: store.backend }));

app.get("/api/meta", (_req, res) =>
  res.json({ classes: CLASSES, total: store.all().length, backend: store.backend }));

app.get("/api/analytics/overview", (req, res) => res.json(overview(scope(req), store)));
app.get("/api/analytics/insights", (req, res) => res.json(insights(scope(req))));

app.get("/api/analytics/risk", (req, res) => {
  const list = scope(req)
    .map((s) => ({ id: s.id, name: s.name, klass: s.klass, ...scoreRisk(s) }))
    .filter((s) => s.level !== "low")
    .sort((a, b) => b.score - a.score);
  res.json(list);
});

app.get("/api/students", (req, res) => {
  const q = (req.query.q || "").toString().toLowerCase();
  const sort = req.query.sort || "final";
  const dir = req.query.dir === "asc" ? 1 : -1;
  let rows = scope(req)
    .filter((s) => s.name.toLowerCase().includes(q) || s.klass.toLowerCase().includes(q))
    .map((s) => { const r = scoreRisk(s); return { ...s, riskScore: r.score, riskLevel: r.level }; });
  rows.sort((a, b) => {
    const av = sort === "risk" ? a.riskScore : a[sort];
    const bv = sort === "risk" ? b.riskScore : b[sort];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  res.json(rows);
});

app.get("/api/students/:id", (req, res) => {
  const s = store.byId(req.params.id);
  if (!s) return res.status(404).json({ error: "Student not found" });
  res.json({ ...s, risk: scoreRisk(s) });
});

app.get("/", (_req, res) => res.type("html").send(PAGE));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log("\n  REGISTRAR — Student Performance Analysis");
    console.log("  Data layer : " + store.backend);
    console.log("  Running at : http://localhost:" + PORT + "\n");
  });
}

module.exports = { app, store, scoreRisk, overview, insights, generateCohort };

/* ───────────────────────── FRONTEND (served at /) ─────────────────────────
   Vanilla JS + Chart.js. No build step. Talks to the REST API above.
   NOTE: this string intentionally avoids backtick template literals inside
   the client script so it can live safely within this server file.
   ──────────────────────────────────────────────────────────────────────── */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Registrar · Student Performance Analysis</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
  :root{
    --paper:#EAEDF3; --ink:#16203A; --inkSoft:#5A6480; --card:#FFFFFF;
    --line:#DCE0E9; --brand:#3B3FA8; --brandSoft:#EEEFFB; --mono:'IBM Plex Mono',monospace;
    --A:#11A06B; --B:#1E7FA8; --C:#C99008; --D:#E0701B; --F:#D23B43;
    --Asoft:#E3F5EE; --Bsoft:#E2F0F6; --Csoft:#FBF1D8; --Dsoft:#FBEADB; --Fsoft:#FBE4E5;
    --high:#D23B43; --mod:#E0701B; --low:#11A06B;
    --highSoft:#FBE4E5; --modSoft:#FBEADB; --lowSoft:#E3F5EE;
  }
  *{box-sizing:border-box}
  body{margin:0;font-family:'Inter',system-ui,sans-serif;background:var(--paper);color:var(--ink);-webkit-font-smoothing:antialiased}
  ::selection{background:rgba(59,63,168,.2)}

  header.top{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:18px 26px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:20;flex-wrap:wrap}
  .brand{display:flex;align-items:center;gap:13px}
  .logo{width:40px;height:40px;border-radius:11px;background:var(--brand);color:#fff;display:grid;place-items:center;box-shadow:0 4px 14px rgba(59,63,168,.35);font-size:20px}
  .title{font-family:'Fraunces',serif;font-weight:700;font-size:21px}
  .sub{font-size:12.5px;color:var(--inkSoft);margin-top:1px}
  .top select{font-family:inherit;font-size:13.5px;font-weight:600;color:var(--ink);background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:9px 14px;cursor:pointer;outline:none}
  .top select:focus-visible{border-color:var(--brand);box-shadow:0 0 0 3px rgba(59,63,168,.18)}

  nav.tabs{display:flex;gap:4px;padding:10px 22px 0;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:77px;z-index:19;overflow-x:auto}
  .tab{display:inline-flex;align-items:center;gap:7px;font-family:inherit;font-size:13.5px;font-weight:600;color:var(--inkSoft);background:none;border:none;cursor:pointer;padding:11px 15px 13px;border-bottom:2.5px solid transparent;white-space:nowrap}
  .tab:hover{color:var(--ink)}
  .tab.on{color:var(--brand);border-bottom-color:var(--brand)}
  .tab .cnt{background:var(--high);color:#fff;font-size:11px;font-weight:700;border-radius:99px;padding:1px 7px}

  main{max-width:1080px;margin:0 auto;padding:24px 22px 60px}
  .stack{display:flex;flex-direction:column;gap:18px;animation:fade .35s ease}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

  .hero{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:18px}
  .heroCard{background:var(--card);border:1px solid var(--line);border-left-width:5px;border-radius:16px;padding:22px 24px;display:flex;align-items:center;gap:20px}
  .heroGrade{font-family:'Fraunces',serif;font-weight:700;font-size:72px;line-height:.9}
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--inkSoft)}
  .heroScore{font-family:'Fraunces',serif;font-weight:600;font-size:34px;margin-top:3px}
  .heroScore span{font-size:16px;color:var(--inkSoft);font-family:'Inter';font-weight:500}
  .heroLine{font-size:13px;color:var(--inkSoft);margin-top:4px}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;align-items:center;gap:13px}
  .kpiIc{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex-shrink:0;font-size:18px}
  .kpiVal{font-size:23px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
  .kpiLbl{font-size:12.5px;color:var(--inkSoft)}

  .panel{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px 20px 14px}
  .panelHead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:14px;flex-wrap:wrap}
  .panelHead h3{font-family:'Fraunces',serif;font-weight:600;font-size:17px;margin:0}
  .panelHead span{font-size:12px;color:var(--inkSoft)}
  .chartWrap{position:relative;height:230px}
  .chartWrap.tall{height:300px}

  .search{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:11px 15px}
  .search input{flex:1;border:none;outline:none;font-family:inherit;font-size:14.5px;color:var(--ink);background:none}
  .search .cnt{font-size:12.5px;color:var(--inkSoft);white-space:nowrap}
  .tableWrap{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;overflow-x:auto}
  table{width:100%;border-collapse:collapse;font-size:14px;min-width:680px}
  th{font-size:11.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:13px 16px;cursor:pointer;user-select:none;border-bottom:1px solid var(--line);background:#FBFBFD;color:var(--inkSoft);white-space:nowrap}
  th.active{color:var(--ink)}
  tbody tr{cursor:pointer;border-bottom:1px solid var(--line)}
  tbody tr:last-child{border-bottom:none}
  tbody tr:hover{background:var(--brandSoft)}
  td{padding:12px 16px}
  .nm{font-weight:600}
  .muted{color:var(--inkSoft)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .gpill{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:9px;font-weight:800;font-size:14px;font-family:var(--mono)}
  .badge{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px}
  .badge .d{width:6px;height:6px;border-radius:99px}

  .lead{font-size:14.5px;line-height:1.6;color:var(--inkSoft);margin:0;max-width:760px}
  .riskHead{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
  .h2{font-family:'Fraunces',serif;font-weight:700;font-size:24px;margin:3px 0 0}
  .riskGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
  .riskCard{text-align:left;font-family:inherit;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 17px;cursor:pointer;display:flex;flex-direction:column;gap:11px;transition:transform .14s,box-shadow .14s}
  .riskCard:hover{transform:translateY(-2px);box-shadow:0 10px 26px rgba(16,24,40,.10)}
  .riskTop{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
  .riskName{font-weight:700;font-size:15px}
  .riskScore{font-weight:800;font-size:18px;border-radius:10px;padding:5px 11px;font-variant-numeric:tabular-nums}
  .riskBar{height:6px;background:var(--paper);border-radius:99px;overflow:hidden}
  .riskBar span{display:block;height:100%;border-radius:99px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:11.5px;font-weight:600;color:var(--ink);background:var(--paper);border-radius:8px;padding:4px 8px}
  .rec{display:flex;gap:7px;align-items:flex-start;font-size:12.5px;color:var(--inkSoft);line-height:1.45}
  .clear{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px 24px;font-size:14.5px;line-height:1.5}

  .drawerBg{position:fixed;inset:0;background:rgba(16,24,40,.42);z-index:50;display:flex;justify-content:flex-end;animation:fade .2s ease}
  .drawer{width:min(440px,100%);height:100%;background:var(--paper);overflow-y:auto;padding:26px 24px 40px;position:relative;box-shadow:-12px 0 40px rgba(16,24,40,.2);animation:slide .28s cubic-bezier(.16,1,.3,1)}
  @keyframes slide{from{transform:translateX(40px);opacity:.4}to{transform:none;opacity:1}}
  .x{position:absolute;top:18px;right:18px;width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--card);color:var(--ink);cursor:pointer;display:grid;place-items:center;font-size:16px}
  .dHead{display:flex;align-items:center;gap:13px;margin:4px 0 20px;padding-right:40px}
  .dName{font-family:'Fraunces',serif;font-weight:700;font-size:21px}
  .dStats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:18px}
  .mini{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}
  .miniVal{font-size:21px;font-weight:800;font-variant-numeric:tabular-nums}
  .miniLbl{font-size:11.5px;color:var(--inkSoft);margin-top:2px}
  .dSec{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 17px;margin-bottom:14px}
  .dSec h4{font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--inkSoft);margin:0 0 10px}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:11px}
  .fact .l{font-size:11.5px;color:var(--inkSoft)}
  .fact .v{font-size:13.5px;font-weight:600}
  .rf{display:flex;justify-content:space-between;font-size:13px;padding:8px 0;border-bottom:1px dashed var(--line)}
  .rf:last-of-type{border-bottom:none}
  .rfw{font-weight:700;color:var(--high);font-variant-numeric:tabular-nums}
  .recBox{display:flex;gap:9px;align-items:flex-start;border:1px solid;border-radius:11px;padding:11px 13px;margin-top:12px;font-size:13px;line-height:1.5}
  .dwChart{position:relative;height:160px}

  .loading{padding:60px;text-align:center;color:var(--inkSoft)}
  .pill-foot{font-size:11.5px;color:var(--inkSoft);text-align:center;padding-top:8px}

  @media (max-width:760px){
    .grid2{grid-template-columns:1fr}
    .hero{grid-template-columns:1fr}
    .heroGrade{font-size:60px}
    main{padding:18px 14px 50px}
    header.top{padding:14px 16px}
    nav.tabs{top:69px;padding-left:12px;padding-right:12px}
  }
  @media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<header class="top">
  <div class="brand">
    <div class="logo">&#127891;</div>
    <div>
      <div class="title">Registrar</div>
      <div class="sub">Student Performance Analysis &middot; Spring 2026 cohort</div>
    </div>
  </div>
  <select id="classFilter" aria-label="Filter by class"><option>All classes</option></select>
</header>

<nav class="tabs" id="tabs"></nav>
<main id="view"><div class="loading">Loading cohort&hellip;</div></main>
<div id="drawer"></div>

<script>
/* ============ client state ============ */
var STATE = { tab:"overview", klass:"All classes", q:"", sort:"final", dir:"desc" };
var CHARTS = [];
var FONT = "'Inter',sans-serif";
var COL = {
  ink:"#16203A", inkSoft:"#5A6480", line:"#DCE0E9", brand:"#3B3FA8", paper:"#EAEDF3",
  A:"#11A06B", B:"#1E7FA8", C:"#C99008", D:"#E0701B", F:"#D23B43"
};
var BANDSOFT = { A:"#E3F5EE", B:"#E2F0F6", C:"#FBF1D8", D:"#FBEADB", F:"#FBE4E5" };
var RISKCOL = { high:"#D23B43", mod:"#E0701B", low:"#11A06B" };
var RISKSOFT = { high:"#FBE4E5", mod:"#FBEADB", low:"#E3F5EE" };
var RISKLBL = { high:"High", mod:"Moderate", low:"Low" };

function bandKey(g){ return g>=90?"A":g>=80?"B":g>=70?"C":g>=60?"D":"F"; }
function gColor(g){ return COL[bandKey(g)]; }

function api(p){ return fetch("/api"+p).then(function(r){ return r.json(); }); }
function el(html){ var d=document.createElement("div"); d.innerHTML=html.trim(); return d.firstChild; }
function destroyCharts(){ CHARTS.forEach(function(c){ try{c.destroy();}catch(e){} }); CHARTS=[]; }

/* shared chart defaults */
Chart.defaults.font.family = FONT;
Chart.defaults.color = COL.inkSoft;
Chart.defaults.plugins.legend.display = false;
Chart.defaults.maintainAspectRatio = false;
var gridCfg = { grid:{ color:COL.line, drawTicks:false }, border:{ display:false }, ticks:{ font:{ size:12 } } };
var passLine = {
  id:"passLine",
  afterDraw:function(c){
    if(!c.options._pass) return;
    var y=c.scales.y; if(!y) return;
    var yp=y.getPixelForValue(60); var ctx=c.ctx;
    ctx.save(); ctx.strokeStyle=COL.F; ctx.setLineDash([4,4]); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(c.chartArea.left,yp); ctx.lineTo(c.chartArea.right,yp); ctx.stroke(); ctx.restore();
  }
};
Chart.register(passLine);

/* ============ tabs ============ */
var TABDEFS = [
  { id:"overview", label:"Overview", icon:"&#128202;" },
  { id:"students", label:"Students", icon:"&#128101;" },
  { id:"insights", label:"Insights", icon:"&#128161;" },
  { id:"risk", label:"At-Risk", icon:"&#128737;" }
];
function renderTabs(atRisk){
  var nav=document.getElementById("tabs"); nav.innerHTML="";
  TABDEFS.forEach(function(t){
    var b=document.createElement("button");
    b.className="tab"+(STATE.tab===t.id?" on":"");
    b.innerHTML=t.icon+" "+t.label+(t.id==="risk"&&atRisk?" <span class='cnt'>"+atRisk+"</span>":"");
    b.onclick=function(){ STATE.tab=t.id; route(); };
    nav.appendChild(b);
  });
}

/* ============ routing ============ */
function route(){
  destroyCharts();
  var v=document.getElementById("view");
  v.innerHTML="<div class='loading'>Loading&hellip;</div>";
  if(STATE.tab==="overview") return renderOverview(v);
  if(STATE.tab==="students") return renderStudents(v);
  if(STATE.tab==="insights") return renderInsights(v);
  if(STATE.tab==="risk") return renderRisk(v);
}

/* ============ OVERVIEW ============ */
function renderOverview(v){
  api("/analytics/overview?class="+encodeURIComponent(STATE.klass)).then(function(d){
    renderTabs(d.atRisk);
    var band=bandKey(d.avg);
    var clsCount = STATE.klass==="All classes" ? 6 : 1;
    v.innerHTML=
      "<div class='stack'>"+
      "<section class='hero'>"+
        "<div class='heroCard' style='border-left-color:"+COL[band]+"'>"+
          "<div class='heroGrade' style='color:"+COL[band]+"'>"+band+"</div>"+
          "<div><div class='eyebrow'>Cohort report card</div>"+
          "<div class='heroScore'>"+d.avg+"<span>/100</span></div>"+
          "<div class='heroLine'>"+d.n+" students &middot; "+clsCount+" class"+(clsCount>1?"es":"")+"</div></div>"+
        "</div>"+
        "<div class='kpis'>"+
          kpi("&#128101;","Students",d.n,COL.brand)+
          kpi("&#9989;","Pass rate",d.passRate.toFixed(0)+"%", d.passRate>=75?RISKCOL.low:RISKCOL.mod)+
          kpi("&#127942;","Avg grade",d.avg,COL[band])+
          kpi("&#9888;","Need support",d.atRisk, d.atRisk>d.n*0.25?RISKCOL.high:RISKCOL.mod)+
        "</div>"+
      "</section>"+
      "<div class='grid2'>"+
        panel("Grade distribution","Final grades by letter band","<div class='chartWrap'><canvas id='cDist'></canvas></div>")+
        panel("Term-over-term trend","Cohort average across grading periods","<div class='chartWrap'><canvas id='cTrend'></canvas></div>")+
      "</div>"+
      panel("Average grade by class","Ranked across the whole cohort","<div class='chartWrap tall'><canvas id='cClass'></canvas></div>")+
      "</div>";

    // distribution
    CHARTS.push(new Chart(document.getElementById("cDist"),{
      type:"bar",
      data:{ labels:d.dist.map(function(x){return x.label;}),
        datasets:[{ data:d.dist.map(function(x){return x.count;}),
          backgroundColor:d.dist.map(function(x){return COL[x.label];}),
          borderRadius:6, maxBarSize:64 }] },
      options:{ scales:{ x:gridCfg, y:Object.assign({beginAtZero:true},gridCfg) },
        plugins:{ tooltip:tip(" students") } }
    }));
    // trend
    CHARTS.push(new Chart(document.getElementById("cTrend"),{
      type:"line",
      data:{ labels:d.trend.map(function(x){return x.term;}),
        datasets:[{ data:d.trend.map(function(x){return x.avg;}),
          borderColor:COL.brand, backgroundColor:"rgba(59,63,168,.08)",
          borderWidth:3, fill:true, tension:.35, pointRadius:5, pointBackgroundColor:COL.brand }] },
      options:{ _pass:true, scales:{ x:gridCfg, y:Object.assign({min:40,max:90},gridCfg) },
        plugins:{ tooltip:tip("") } }
    }));
    // by class (horizontal)
    CHARTS.push(new Chart(document.getElementById("cClass"),{
      type:"bar",
      data:{ labels:d.byClass.map(function(x){return x.klass;}),
        datasets:[{ data:d.byClass.map(function(x){return x.avg;}),
          backgroundColor:d.byClass.map(function(x){return gColor(x.avg);}),
          borderRadius:6, maxBarSize:26 }] },
      options:{ indexAxis:"y", scales:{ x:Object.assign({min:0,max:100},gridCfg), y:gridCfg },
        plugins:{ tooltip:tip("") } }
    }));
  });
}

/* ============ STUDENTS ============ */
function renderStudents(v){
  var qs="/students?class="+encodeURIComponent(STATE.klass)+"&q="+encodeURIComponent(STATE.q)+"&sort="+STATE.sort+"&dir="+STATE.dir;
  api(qs).then(function(rows){
    api("/analytics/overview?class="+encodeURIComponent(STATE.klass)).then(function(o){ renderTabs(o.atRisk); });
    var cols=[["name","Student","l"],["klass","Class","l"],["attendance","Attend.","r"],
      ["studyHours","Study/wk","r"],["final","Final","r"],["final","Grade","c"],["risk","Risk","r"]];
    var head=cols.map(function(c){
      var active=STATE.sort===c[0]?" active":"";
      var arrow=STATE.sort===c[0]?(STATE.dir==="asc"?" &#9650;":" &#9660;"):"";
      var align=c[2]==="r"?"text-align:right":c[2]==="c"?"text-align:center":"text-align:left";
      return "<th class='"+active.trim()+"' data-k='"+c[0]+"' style='"+align+"'>"+c[1]+arrow+"</th>";
    }).join("")+"<th></th>";

    var body=rows.map(function(s){
      return "<tr data-id='"+s.id+"'>"+
        "<td class='nm'>"+s.name+"</td>"+
        "<td class='muted'>"+s.klass+"</td>"+
        "<td class='num'>"+s.attendance+"%</td>"+
        "<td class='num'>"+s.studyHours+"h</td>"+
        "<td class='num' style='font-weight:700'>"+s.final+"</td>"+
        "<td style='text-align:center'>"+gpill(s.final)+"</td>"+
        "<td class='num'>"+badge(RISKLBL[s.riskLevel],RISKCOL[s.riskLevel],RISKSOFT[s.riskLevel],true)+"</td>"+
        "<td>&#8250;</td></tr>";
    }).join("");
    if(!rows.length) body="<tr><td colspan='8' style='text-align:center;color:"+COL.inkSoft+";padding:34px'>No students match your search.</td></tr>";

    v.innerHTML="<div class='stack'>"+
      "<div class='search'>&#128269;<input id='q' placeholder='Search by name or class…' value=\""+STATE.q+"\"><span class='cnt'>"+rows.length+" shown</span></div>"+
      "<div class='tableWrap'><table><thead><tr>"+head+"</tr></thead><tbody>"+body+"</tbody></table></div>"+
      "</div>";

    var q=document.getElementById("q");
    q.oninput=function(){ STATE.q=q.value; var pos=q.value.length; renderStudents(v); setTimeout(function(){ var n=document.getElementById("q"); if(n){n.focus();n.setSelectionRange(pos,pos);} },0); };
    Array.prototype.forEach.call(v.querySelectorAll("th[data-k]"),function(th){
      th.onclick=function(){ var k=th.getAttribute("data-k");
        if(STATE.sort===k) STATE.dir=STATE.dir==="desc"?"asc":"desc"; else { STATE.sort=k; STATE.dir="desc"; }
        renderStudents(v); };
    });
    Array.prototype.forEach.call(v.querySelectorAll("tbody tr[data-id]"),function(tr){
      tr.onclick=function(){ openDrawer(tr.getAttribute("data-id")); };
    });
  });
}

/* ============ INSIGHTS ============ */
function renderInsights(v){
  api("/analytics/insights?class="+encodeURIComponent(STATE.klass)).then(function(d){
    api("/analytics/overview?class="+encodeURIComponent(STATE.klass)).then(function(o){ renderTabs(o.atRisk); });
    v.innerHTML="<div class='stack'>"+
      "<p class='lead'>What actually moves outcomes in this cohort. Each chart compares average final grade across a single factor — the steeper the climb, the stronger that factor's relationship with performance.</p>"+
      "<div class='grid2'>"+
        factorPanel("Weekly study time","More time studying, higher grades","fStudy")+
        factorPanel("Attendance","Showing up is the strongest single lever","fAtt")+
        factorPanel("Prior course failures","Past failures compound","fFail")+
        factorPanel("Parental education","Household academic background","fEdu")+
      "</div>"+
      panel("Attendance vs. final grade","Each dot is a student, colored by letter grade","<div class='chartWrap tall'><canvas id='fScatter'></canvas></div>")+
      "</div>";
    factorChart("fStudy",d.study); factorChart("fAtt",d.att);
    factorChart("fFail",d.fails); factorChart("fEdu",d.edu,true);

    CHARTS.push(new Chart(document.getElementById("fScatter"),{
      type:"scatter",
      data:{ datasets:[{ data:d.scatter.map(function(p){return {x:p.x,y:p.y};}),
        pointBackgroundColor:d.scatter.map(function(p){return COL[p.band];}),
        pointRadius:4.5, pointHoverRadius:6 }] },
      options:{ _pass:true,
        scales:{ x:Object.assign({min:45,max:100,title:{display:true,text:"Attendance %",color:COL.inkSoft}},gridCfg),
                 y:Object.assign({min:0,max:100,title:{display:true,text:"Final grade",color:COL.inkSoft}},gridCfg) },
        plugins:{ tooltip:{ callbacks:{ label:function(c){ return "Attendance "+c.parsed.x+"% · Final "+c.parsed.y; } },
          backgroundColor:COL.ink, padding:10, cornerRadius:8, displayColors:false } } }
    }));
  });
}
function factorChart(id,data,rotate){
  CHARTS.push(new Chart(document.getElementById(id),{
    type:"bar",
    data:{ labels:data.map(function(x){return x.label;}),
      datasets:[{ data:data.map(function(x){return x.avg;}),
        backgroundColor:data.map(function(x){return gColor(x.avg);}),
        borderRadius:5, maxBarSize:46 }] },
    options:{ _pass:true,
      scales:{ x:Object.assign({ticks:{maxRotation:rotate?40:0,minRotation:rotate?30:0,font:{size:11}}},gridCfg),
               y:Object.assign({min:0,max:100},gridCfg) },
      plugins:{ tooltip:tip("") } }
  }));
}

/* ============ AT-RISK ============ */
function renderRisk(v){
  api("/analytics/risk?class="+encodeURIComponent(STATE.klass)).then(function(list){
    renderTabs(list.length);
    var head="<div class='riskHead'><div><div class='eyebrow'>Early-warning list</div>"+
      "<h2 class='h2'>"+list.length+" students need attention</h2></div>"+
      "<div style='display:flex;gap:8px'>"+badge("High",RISKCOL.high,RISKSOFT.high,true)+badge("Moderate",RISKCOL.mod,RISKSOFT.mod,true)+"</div></div>"+
      "<p class='lead'>Risk is a 0–100 score from five weighted, explainable signals: failing grade, declining trend, low attendance, prior failures, and low study time. Open any student for the full breakdown.</p>";

    if(!list.length){
      v.innerHTML="<div class='stack'>"+head+"<div class='clear'>&#9989; <div><b>No students flagged in this view.</b><br><span class='muted'>Everyone here is tracking above the risk threshold.</span></div></div></div>";
      return;
    }
    var cards=list.map(function(s){
      var c=RISKCOL[s.level], soft=RISKSOFT[s.level];
      var chips=s.factors.slice(0,2).map(function(f){return "<span class='chip'>"+f.label+"</span>";}).join("");
      if(s.factors.length>2) chips+="<span class='chip'>+"+(s.factors.length-2)+" more</span>";
      return "<button class='riskCard' data-id='"+s.id+"'>"+
        "<div class='riskTop'><div><div class='riskName'>"+s.name+"</div><div class='muted' style='font-size:12.5px'>"+s.klass+"</div></div>"+
        "<div class='riskScore' style='color:"+c+";background:"+soft+"'>"+s.score+"</div></div>"+
        "<div class='riskBar'><span style='width:"+s.score+"%;background:"+c+"'></span></div>"+
        "<div class='chips'>"+chips+"</div>"+
        "<div class='rec'>&#128161; "+s.rec+"</div></button>";
    }).join("");
    v.innerHTML="<div class='stack'>"+head+"<div class='riskGrid'>"+cards+"</div></div>";
    Array.prototype.forEach.call(v.querySelectorAll(".riskCard"),function(b){
      b.onclick=function(){ openDrawer(b.getAttribute("data-id")); };
    });
  });
}

/* ============ DRAWER ============ */
function openDrawer(id){
  api("/students/"+id).then(function(s){
    var c=RISKCOL[s.risk.level], soft=RISKSOFT[s.risk.level];
    var delta=s.final-s.t1;
    var trendStr=(delta>=0?"+":"")+delta;
    var trendColor=delta>1?RISKCOL.low:delta<-1?RISKCOL.high:COL.inkSoft;
    var factors=s.risk.factors.map(function(f){ return "<div class='rf'><span>"+f.label+"</span><span class='rfw'>+"+f.weight+"</span></div>"; }).join("");
    var recBox=s.risk.factors.length? "<div class='recBox' style='border-color:"+c+";background:"+soft+"'>&#128161; <span>"+s.risk.rec+"</span></div>":"";

    var html="<div class='drawerBg' id='dbg'><aside class='drawer' role='dialog'>"+
      "<button class='x' id='dx'>&times;</button>"+
      "<div class='dHead'>"+gpill(s.final)+"<div><div class='dName'>"+s.name+"</div><div class='muted'>"+s.klass+" &middot; Age "+s.age+"</div></div></div>"+
      "<div class='dStats'>"+
        "<div class='mini'><div class='miniVal' style='color:"+gColor(s.final)+"'>"+s.final+"</div><div class='miniLbl'>Final</div></div>"+
        "<div class='mini'><div class='miniVal' style='color:"+trendColor+"'>"+trendStr+"</div><div class='miniLbl'>Trend</div></div>"+
        "<div class='mini'><div class='miniVal' style='color:"+c+"'>"+s.risk.score+"</div><div class='miniLbl'>Risk</div></div>"+
      "</div>"+
      "<div class='dSec'><h4>Grade trajectory</h4><div class='dwChart'><canvas id='dwTrend'></canvas></div></div>"+
      "<div class='dSec'><h4>Profile balance</h4><div class='dwChart' style='height:200px'><canvas id='dwRadar'></canvas></div></div>"+
      "<div class='dSec'><h4>Factors &amp; support</h4><div class='facts'>"+
        fact("Study time",s.studyHours+" hrs/week")+fact("Attendance",s.attendance+"%")+
        fact("Prior failures",s.failures)+fact("Parent education",s.parentEdu)+
        fact("Tutoring",s.tutoring?"Enrolled":"None")+fact("Extracurricular",s.extracurric?"Yes":"No")+
      "</div></div>"+
      (s.risk.factors.length?"<div class='dSec'><h4>Risk breakdown</h4>"+factors+recBox+"</div>":"")+
      "</aside></div>";
    var d=document.getElementById("drawer"); d.innerHTML=html;
    document.getElementById("dx").onclick=closeDrawer;
    document.getElementById("dbg").onclick=function(e){ if(e.target.id==="dbg") closeDrawer(); };

    new Chart(document.getElementById("dwTrend"),{
      type:"line",
      data:{ labels:["Term 1","Term 2","Final"],
        datasets:[{ data:[s.t1,s.t2,s.final], borderColor:COL.brand, borderWidth:2.5, tension:.3,
          pointRadius:4, pointBackgroundColor:COL.brand, fill:false }] },
      options:{ _pass:true, scales:{ x:gridCfg, y:Object.assign({min:0,max:100},gridCfg) }, plugins:{tooltip:tip("")} }
    });
    new Chart(document.getElementById("dwRadar"),{
      type:"radar",
      data:{ labels:["Study","Attend","Grade","Stability","History"],
        datasets:[{ data:[
            Math.min(100,(s.studyHours/14)*100), s.attendance, s.final,
            Math.max(0,100-Math.abs(s.t1-s.final)*4), Math.max(0,100-s.failures*28)],
          borderColor:COL.brand, backgroundColor:"rgba(59,63,168,.18)", borderWidth:2, pointRadius:2 }] },
      options:{ scales:{ r:{ min:0,max:100, grid:{color:COL.line}, angleLines:{color:COL.line},
        pointLabels:{ font:{size:11}, color:COL.inkSoft }, ticks:{display:false} } } }
    });
  });
}
function closeDrawer(){ document.getElementById("drawer").innerHTML=""; }

/* ============ small html helpers ============ */
function kpi(icon,label,val,tone){
  return "<div class='kpi'><div class='kpiIc' style='color:"+tone+";background:"+tone+"18'>"+icon+"</div>"+
    "<div><div class='kpiVal'>"+val+"</div><div class='kpiLbl'>"+label+"</div></div></div>";
}
function panel(title,hint,inner){
  return "<section class='panel'><div class='panelHead'><h3>"+title+"</h3><span>"+hint+"</span></div>"+inner+"</section>";
}
function factorPanel(title,sub,id){
  return "<section class='panel'><div class='panelHead'><h3>"+title+"</h3><span>"+sub+"</span></div><div class='chartWrap' style='height:200px'><canvas id='"+id+"'></canvas></div></section>";
}
function gpill(g){ var k=bandKey(g); return "<span class='gpill' style='color:"+COL[k]+";background:"+BANDSOFT[k]+"'>"+k+"</span>"; }
function badge(text,color,soft,dot){
  return "<span class='badge' style='color:"+color+";background:"+soft+"'>"+(dot?"<span class='d' style='background:"+color+"'></span>":"")+text+"</span>";
}
function fact(l,v){ return "<div class='fact'><div class='l'>"+l+"</div><div class='v'>"+v+"</div></div>"; }
function tip(suffix){
  return { backgroundColor:COL.ink, padding:10, cornerRadius:8, displayColors:false,
    callbacks:{ label:function(c){ return (c.parsed.y!==undefined?c.parsed.y:c.parsed.x)+suffix; } } };
}

/* ============ boot ============ */
api("/meta").then(function(m){
  var sel=document.getElementById("classFilter");
  m.classes.forEach(function(c){ var o=document.createElement("option"); o.textContent=c; sel.appendChild(o); });
  sel.onchange=function(){ STATE.klass=sel.value; route(); };
  route();
});
</script>
</body>
</html>`;
