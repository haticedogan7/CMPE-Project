import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** 1) Firebase **/
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

/** 2) UI hooks **/
const statusEl   = document.getElementById("status");
const introEl    = document.getElementById("intro");
const startBtn   = document.getElementById("startBtn");

const cardEl     = document.getElementById("card");
const qtextEl    = document.getElementById("qtext");
const doneEl     = document.getElementById("done");

const doneTextEl = document.getElementById("doneText");
const scoresEl   = document.getElementById("scores");

const backBtn    = document.getElementById("backBtn"); // add in index.html

const pidInput = document.getElementById("pidInput");
let participantId = null;


// Hard lock initial visibility (prevents “question flashes”)
if (cardEl) cardEl.style.display = "none";
if (doneEl) doneEl.style.display = "none";
if (statusEl) statusEl.textContent = "";

/** 3) Load item bank **/
const bank = await fetch("./items.json").then(r => r.json());
const thetaGrid   = makeThetaGrid(bank.thetaGrid.min, bank.thetaGrid.max, bank.thetaGrid.n);
const tau         = bank.tauStdStop ?? 0.55;
const maxItems    = bank.maxItems ?? 50;
const agreeCutoff = bank.agreeCutoff ?? 4;

const traits = ["E","N","A","C","O"];
const byTrait = Object.fromEntries(traits.map(t => [t, []]));
for (const it of bank.items) byTrait[it.trait].push(it);

/** 4) Session state **/
const sessionId = crypto.randomUUID();
const asked = new Set();
const log = []; // {id, trait, likert, scoredLikert, u, ts}

// independent posteriors per trait
const post = Object.fromEntries(traits.map(t => [t, normalPdf(thetaGrid, 0, 1)]));
for (const t of traits) normalizeInPlace(post[t]);

let currentItem = null;
let started = false;

/** 5) Likert button handlers **/
document.querySelectorAll("button[data-v]").forEach(btn => {
  btn.addEventListener("click", async () => {
    if (!started) return;
    const likert = Number(btn.dataset.v);
    await answerCurrent(likert);
  });
});

/** 6) Start **/
/** 6) Start **/
startBtn?.addEventListener("click", () => {
  participantId = (pidInput.value || "").trim();

  if (!participantId) {
    alert("Please enter a username so we can match your results.");
    return;
  }

  started = true;

  if (introEl) introEl.style.display = "none";
  if (doneEl) doneEl.style.display = "none";
  if (cardEl) cardEl.style.display = "block";

  updateStatus();
  nextQuestion();
});

/** 7) Back **/
backBtn?.addEventListener("click", () => {
  if (!started) return;
  goBack();
});

/** === Core adaptive logic === **/

function nextQuestion() {
  // compute mu/sd per trait
  const mu = {}, sd = {};
  for (const t of traits) {
    mu[t] = dot(thetaGrid, post[t]);
    sd[t] = Math.sqrt(dot(thetaGrid.map(x => (x-mu[t])**2), post[t]));
  }

  // stopping rule
  if (traits.every(t => sd[t] <= tau) || log.length >= maxItems) {
    finish(mu, sd);
    return;
  }

  // pick trait with max SD (random tie-break)
  const maxSd = Math.max(...traits.map(t => sd[t]));
  const ties = traits.filter(t => Math.abs(sd[t] - maxSd) < 1e-12);
  const tPick = ties[Math.floor(Math.random() * ties.length)];

  // pick most informative unasked item within that trait at current mu
  const candidates = byTrait[tPick].filter(it =>
    !asked.has(it.id) && Number.isFinite(it.a) && Number.isFinite(it.b)
  );

  if (candidates.length === 0) {
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

  // show question
  if (qtextEl) qtextEl.textContent = best.text;   // no "O8:"
  if (cardEl) cardEl.style.display = "block";
  if (doneEl) doneEl.style.display = "none";

  updateStatus();
  updateBackButton();
}

async function answerCurrent(likert) {
  if (!currentItem) return;

  const scoredLikert = currentItem.reverse ? (6 - likert) : likert;
  const u = scoredLikert >= agreeCutoff ? 1 : 0;

  // posterior update for that trait only
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

function goBack() {
  if (log.length === 0) return;

  // remove last answer
  const last = log.pop();
  asked.delete(last.id);

  // reset posteriors
  for (const t of traits) {
    post[t] = normalPdf(thetaGrid, 0, 1);
    normalizeInPlace(post[t]);
  }

  // replay answers to rebuild posteriors
  for (const ans of log) {
    const it = bank.items.find(x => x.id === ans.id);
    if (!it) continue;

    const t = it.trait;
    const pGrid = thetaGrid.map(th => sigmoid(it.a * (th - it.b)));
    const like = pGrid.map(p => (ans.u ? p : (1 - p)));

    for (let i=0;i<post[t].length;i++) post[t][i] *= like[i];
    normalizeInPlace(post[t]);
  }

  // show the previous question again (the one we removed)
  currentItem = bank.items.find(x => x.id === last.id) || null;
  if (currentItem && qtextEl) qtextEl.textContent = currentItem.text;

  updateStatus();
  updateBackButton();
}

async function finish(mu, sd) {
  if (cardEl) cardEl.style.display = "none";
  if (doneEl) doneEl.style.display = "block";

  const result = {
    mode: "adaptive",
    participantId,   
    sessionId,
    createdAt: Date.now(),
    tau,
    maxItems,
    nItems: log.length,
    thetaHat: mu,
    thetaSd: sd,
    answers: log
  };

  // user-friendly display
  function band(theta){
    if (theta < -0.5) return "Below average";
    if (theta >  0.5) return "Above average";
    return "Around average";
  }
  function conf(s){
    if (s < 0.45) return "High";
    if (s < 0.55) return "Medium";
    return "Low";
  }

  if (doneTextEl) doneTextEl.textContent = `You answered ${log.length} questions.`;

  if (scoresEl) {
    scoresEl.innerHTML = traits.map(t => {
      const label = ({
        E: "Extraversion",
        N: "Neuroticism",
        A: "Agreeableness",
        C: "Conscientiousness",
        O: "Openness"
      })[t];

      return `
        <div class="scoreRow">
          <div class="scoreName">${label}</div>
          <div class="scoreVal">${band(mu[t])}</div>
          <div class="scoreSd">Confidence: ${conf(sd[t])}</div>
        </div>
      `;
    }).join("");
  }

  // save
  try {
    await addDoc(collection(db, "sessions"), { ...result, serverTime: serverTimestamp() });
    if (statusEl) statusEl.textContent = "Saved ✅";
  } catch (e) {
    if (statusEl) statusEl.textContent = "Could not save (check Firebase rules/config).";
    console.error(e);
  }
}

/** === UI helpers === **/
function updateStatus() {
  if (!statusEl) return;
  if (!started) { statusEl.textContent = ""; return; }
  statusEl.textContent = `Progress: ${log.length} answered`;
}

function updateBackButton() {
  if (!backBtn) return;
  const disabled = (log.length === 0);
  backBtn.disabled = disabled;
  backBtn.style.opacity = disabled ? "0.5" : "1";
  backBtn.style.cursor = disabled ? "not-allowed" : "pointer";
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
  let s=0;
  for (let i=0;i<a.length;i++) s += a[i]*b[i];
  return s;
}
