import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** 1) Firebase config (replace with yours) **/
const firebaseConfig = {
  apiKey: "AIzaSyDa6ofbWJPYsjbtVM0Gd2HQLspkaOxc0y8",
  authDomain: "adaptive-test-551f0.firebaseapp.com",
  projectId: "adaptive-test-551f0",
  storageBucket: "adaptive-test-551f0.firebasestorage.app",
  messagingSenderId: "522468315836",
  appId: "1:522468315836:web:1de06402d7996f50b536b9",
  measurementId: "G-FE1E9HT8T1"
};
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

/** 2) Load item bank **/
const bank = await fetch("./items.json").then(r => r.json());
const thetaGrid = makeThetaGrid(bank.thetaGrid.min, bank.thetaGrid.max, bank.thetaGrid.n);
const tau = bank.tauStdStop ?? 0.55;
const maxItems = bank.maxItems ?? 50;
const agreeCutoff = bank.agreeCutoff ?? 4;

const traits = ["E","N","A","C","O"];
const byTrait = Object.fromEntries(traits.map(t => [t, []]));
for (const it of bank.items) byTrait[it.trait].push(it);

/** 3) Session state **/
const sessionId = crypto.randomUUID();
const asked = new Set();
const log = []; // {id, trait, likert, u, t}

// independent posteriors per trait
const post = Object.fromEntries(traits.map(t => [t, normalPdf(thetaGrid, 0, 1)]));
for (const t of traits) normalizeInPlace(post[t]);

/** 4) UI hooks **/
const statusEl = document.getElementById("status");
const cardEl = document.getElementById("card");
const qtextEl = document.getElementById("qtext");
const doneEl = document.getElementById("done");
const resultEl = document.getElementById("result");

document.querySelectorAll("button[data-v]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const likert = Number(btn.dataset.v);
    await answerCurrent(likert);
  });
});

let currentItem = null;

/** 5) Start **/
nextQuestion();

/** === Core adaptive logic === **/

function nextQuestion() {
  // compute mu/sd per trait
  const mu = {}, sd = {};
  for (const t of traits) {
    mu[t] = dot(thetaGrid, post[t]);
    sd[t] = Math.sqrt(dot(thetaGrid.map(x => (x-mu[t])**2), post[t]));
  }

  // stopping rule: all traits confident enough OR reached maxItems
  if (traits.every(t => sd[t] <= tau) || log.length >= maxItems) {
    finish(mu, sd);
    return;
  }

  // pick trait with max sd (random tie-break)
  const maxSd = Math.max(...traits.map(t => sd[t]));
  const ties = traits.filter(t => Math.abs(sd[t] - maxSd) < 1e-12);
  const tPick = ties[Math.floor(Math.random() * ties.length)];

  // pick most informative unasked item within that trait at mu
  const candidates = byTrait[tPick].filter(it => !asked.has(it.id) && Number.isFinite(it.a) && Number.isFinite(it.b));
  if (candidates.length === 0) {
    // if a trait runs out (rare), mark it "done" by forcing posterior to be very peaked
    // easiest: just continue and let stopping happen naturally
    finish(mu, sd);
    return;
  }

  const muNow = mu[tPick];
  let best = null, bestInfo = -Infinity;
  for (const it of candidates) {
    const p = sigmoid(it.a * (muNow - it.b));
    const info = (it.a ** 2) * p * (1 - p);
    if (info > bestInfo) { bestInfo = info; best = it; }
  }

  currentItem = best;
  asked.add(best.id);

  // show
  statusEl.textContent = `Progress: ${log.length} answered • target τ=${tau}`;
  qtextEl.textContent = `${best.id}: ${best.text}`;
  cardEl.style.display = "block";
  doneEl.style.display = "none";
}

async function answerCurrent(likert) {
  if (!currentItem) return;

  // reverse-key in UI scoring if needed
  const scoredLikert = currentItem.reverse ? (6 - likert) : likert;

  // binarize
  const u = scoredLikert >= agreeCutoff ? 1 : 0;

  // update posterior for that trait
  const t = currentItem.trait;
  const pGrid = thetaGrid.map(th => sigmoid(currentItem.a * (th - currentItem.b)));
  const like = pGrid.map(p => (u ? p : (1 - p)));
  for (let i=0;i<post[t].length;i++) post[t][i] *= like[i];
  normalizeInPlace(post[t]);

  log.push({
    id: currentItem.id,
    trait: currentItem.trait,
    likert,
    scoredLikert,
    u,
    ts: Date.now()
  });

  nextQuestion();
}

async function finish(mu, sd) {
  cardEl.style.display = "none";
  doneEl.style.display = "block";

  const result = {
    sessionId,
    createdAt: Date.now(),
    tau,
    maxItems,
    nItems: log.length,
    thetaHat: mu,
    thetaSd: sd,
    answers: log
  };

  resultEl.textContent = JSON.stringify(result, null, 2);

  // save to Firestore
  try {
    await addDoc(collection(db, "sessions"), { ...result, serverTime: serverTimestamp() });
    statusEl.textContent = "Saved ✅";
  } catch (e) {
    statusEl.textContent = "Could not save (check Firebase rules/config).";
    console.error(e);
  }
}

/** === utilities === **/

function makeThetaGrid(min, max, n) {
  const out = [];
  for (let i=0;i<n;i++) out.push(min + (max-min)*i/(n-1));
  return out;
}
function sigmoid(z) { return 1/(1+Math.exp(-z)); }
function normalPdf(xs, m, s) {
  const c = 1/(s*Math.sqrt(2*Math.PI));
  return xs.map(x => c * Math.exp(-0.5*((x-m)/s)**2));
}
function normalizeInPlace(p) {
  const s = p.reduce((a,b)=>a+b,0);
  for (let i=0;i<p.length;i++) p[i] /= s;
}
function dot(a, b) {
  let s=0; for (let i=0;i<a.length;i++) s += a[i]*b[i];
  return s;
}
