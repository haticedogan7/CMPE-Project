import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

/** Firebase config (same as adaptive) **/
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

/** UI **/
const statusEl   = document.getElementById("status");
const introEl    = document.getElementById("intro");
const startBtn   = document.getElementById("startBtn");

const cardEl     = document.getElementById("card");
const qtextEl    = document.getElementById("qtext");
const backBtn    = document.getElementById("backBtn");

const doneEl     = document.getElementById("done");
const doneTextEl = document.getElementById("doneText");
const scoresEl   = document.getElementById("scores");

// initial state
cardEl.style.display = "none";
doneEl.style.display = "none";
statusEl.textContent = "";

/** Load item bank **/
const bank = await fetch("./items.json").then(r => r.json());
const items = bank.items;

// We want a deterministic full-test order.
// Here: E1..E10, N1..N10, A1..A10, C1..C10, O1..O10
const traits = ["E","N","A","C","O"];
const ordered = [];
for (const t of traits) {
  const group = items
    .filter(it => it.trait === t)
    .sort((a,b) => num(a.id) - num(b.id));
  ordered.push(...group);
}

const participantId = getOrCreateParticipantId();
const sessionId = crypto.randomUUID();

let started = false;
let idx = 0;
const answers = []; // length 50; each {id, trait, likert, scoredLikert, ts}

document.querySelectorAll("button[data-v]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (!started) return;
    const likert = Number(btn.dataset.v);
    recordAnswer(likert);
  });
});

startBtn.addEventListener("click", () => {
  started = true;
  introEl.style.display = "none";
  doneEl.style.display = "none";
  cardEl.style.display = "block";
  idx = 0;
  answers.length = 0;
  renderQuestion();
  updateBack();
});

backBtn.addEventListener("click", () => {
  if (!started) return;
  if (idx === 0) return;
  // Go back one question
  idx -= 1;
  answers.pop();
  renderQuestion();
  updateBack();
});

function renderQuestion() {
  const it = ordered[idx];
  qtextEl.textContent = it.text;
  statusEl.textContent = `Progress: ${idx} / 50 answered`;
}

function recordAnswer(likert) {
  const it = ordered[idx];
  const scoredLikert = it.reverse ? (6 - likert) : likert;

  answers.push({
    id: it.id,
    trait: it.trait,
    likert,
    scoredLikert,
    ts: Date.now()
  });

  idx += 1;

  if (idx >= ordered.length) {
    finish();
  } else {
    renderQuestion();
    updateBack();
  }
}

function updateBack() {
  const disabled = (idx === 0);
  backBtn.disabled = disabled;
  backBtn.style.opacity = disabled ? "0.5" : "1";
  backBtn.style.cursor = disabled ? "not-allowed" : "pointer";
}

async function finish() {
  cardEl.style.display = "none";
  doneEl.style.display = "block";
  statusEl.textContent = "";

  // Compute trait means (1..5) using scoredLikert
  const traitMeans = {};
  for (const t of traits) {
    const vals = answers.filter(a => a.trait === t).map(a => a.scoredLikert);
    traitMeans[t] = vals.reduce((s,x)=>s+x,0) / vals.length;
  }

  doneTextEl.textContent = `You answered all 50 questions.`;

  const labelMap = {E:"Extraversion",N:"Neuroticism",A:"Agreeableness",C:"Conscientiousness",O:"Openness"};
  scoresEl.innerHTML = traits.map(t => {
    return `
      <div class="scoreRow">
        <div class="scoreName">${labelMap[t]}</div>
        <div class="scoreVal">${traitMeans[t].toFixed(2)} / 5</div>
        <div class="scoreSd">Baseline (full test)</div>
      </div>
    `;
  }).join("");

  const payload = {
    mode: "full",
    participantId,           // lets you pair with adaptive later
    sessionId,
    createdAt: Date.now(),
    fullScoresLikertMean: traitMeans,
    answers
  };

  try {
    await addDoc(collection(db, "sessions"), { ...payload, serverTime: serverTimestamp() });
    statusEl.textContent = "Saved ✅";
  } catch (e) {
    statusEl.textContent = "Could not save (check Firebase rules/config).";
    console.error(e);
  }
}

function num(id) {
  // "E10" -> 10
  return Number(id.slice(1));
}

function getOrCreateParticipantId() {
  const key = "participantId_big5";
  let v = localStorage.getItem(key);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(key, v);
  }
  return v;
}
