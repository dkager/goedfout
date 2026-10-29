// Presentatiemotor: whiteboard met kanban en vraagzone (werkafspraken op verzoek als overlay),
// flip-over links (tips) en rechts (steekwoorden). Alle weergave wordt afgeleid uit één positie:
//   pos = { sheet: index in de platte lijst van vellen, step: aantal uitgevoerde steps (klikken) }
// sheet === -1 is het donkere startscherm, sheet === aantal vellen het donkere afsluitscherm.
// Een step is een lijst van items (keyword, tip, question, check, pin, unpin) die bij één klik
// verschijnen.

import { payloadKey, decryptTextWith, newKey, encryptTextWith, encryptBytes, decryptBytes, WrongPasswordError } from './crypto-core.js';
import { zipFiles } from './zip.js';
import { normalizeContent, KEYWORD_COLORS, KEYWORD_INDENTS, KEYWORD_GAPS, GOAL_IDS, GOALS_MAX, GOAL_TEXT_MAX, SHEET_TITLE_MAX, TOPIC_NAME_MAX, TOPICS_MAX, IMAGE_NAME, dropRepeatedChecks } from './content.js';
import { stepsToText, textToSteps, listToText, textToList, pinProblem } from './sheet-text.js';

const STAGE_W = 1600;
const STAGE_H = 900;
// Grootste lettergrootte op de flip-overs (tips en steekwoorden), ook op een bijna leeg vel.
// Kleiner wordt het alleen als een vel vol raakt (tot de minPx van fitList).
const LIST_FONT_MAX = 32; // px

const $ = (sel) => document.querySelector(sel);
const els = {
  soundBtn: $('#btn-sound'),
  login: $('#login'),
  form: $('#login-form'),
  demoLink: $('#demo-link'),
  password: $('#password'),
  loginError: $('#login-error'),
  viewport: $('#viewport'),
  stage: $('#stage'),
  tipsSheet: $('#tips-sheet'),
  tipsList: $('#tips-list'),
  announcer: $('#announcer'),
  pinLayer: $('#pin-layer'),
  keywordPad: $('#keyword-pad'),
  keywordSheet: $('#keyword-sheet'),
  keywordList: $('#keyword-list'),
  keywordTitle: $('#keyword-title'),
  startSubtitle: $('#start-subtitle'),
  agreements: $('#agreements-list'),
  goals: $('#goals-list'),
  agreementsBox: $('#agreements'),
  agreementsBtn: $('#btn-agreements'),
  agreementsEditBtn: $('#btn-agreements-edit'),
  imagesBtn: $('#btn-images'),
  imagesDialog: $('#images-dialog'),
  imagesList: $('#images-list'),
  imagesStatus: $('#images-status'),
  imagesFile: $('#images-file'),
  imagesUpload: $('#images-upload'),
  imagesClose: $('#images-close'),
  askDialog: $('#ask-dialog'),
  askForm: $('#ask-form'),
  askText: $('#ask-text'),
  askOk: $('#ask-ok'),
  askCancel: $('#ask-cancel'),
  exportUnused: $('#export-unused'),
  addSheetBtn: $('#btn-sheet-add'),
  topicTools: $('#topic-tools'),
  topicEarlier: $('#btn-topic-earlier'),
  topicLater: $('#btn-topic-later'),
  sheetEarlier: $('#btn-sheet-earlier'),
  sheetLater: $('#btn-sheet-later'),
  addTopicBtn: $('#btn-topic-add'),
  deleteTopicBtn: $('#btn-topic-delete'),
  deleteSheetBtn: $('#btn-sheet-delete'),
  kanban: $('.kanban'),
  cols: { todo: $('#col-todo'), doing: $('#col-doing'), done: $('#col-done') },
  addTip: $('#add-tip'),
  tipForm: $('#tip-form'),
  tipInput: $('#tip-input'),
  editBtn: $('#btn-edit'),
  notice: $('#edit-notice'),
  question: $('#wb-question'),
  questionText: $('#wb-question-text'),
  progress: $('#progress'),
  prev: $('#btn-prev'),
  next: $('#btn-next'),
  prevSheet: $('#btn-prev-sheet'),
  nextSheet: $('#btn-next-sheet'),
  startScreen: $('#start-screen'),
  endScreen: $('#end-screen'),
  endDownload: $('#end-download'),
  endNote: $('#end-note'),
  exportBtn: $('#btn-export'),
  exportDialog: $('#export-dialog'),
  exportForm: $('#export-form'),
  exportPw1: $('#export-pw1'),
  exportPw2: $('#export-pw2'),
  exportStatus: $('#export-status'),
  exportOk: $('#export-ok'),
  exportCancel: $('#export-cancel'),
  pdf: $('#btn-pdf'),
  print: $('#print'),
  controls: document.querySelector('.controls'),
};

let rawContent = null;    // de inhoud precies zoals geladen (nooit gewijzigd), voor de export
let deck = null;          // het model: genormaliseerde kopie van de inhoud; wijzigingen gaan hierin
let flat = [];            // [{ topic, sheet, title, steps: [[item, …], …], model }] (steps en model: dezelfde als in deck)
let firstSheetOfTopic = [];
let pos = { sheet: 0, step: 0 };
let stickies = [];        // knop-elementen, index = onderwerp
let stickyFontPx = 22;    // maximale lettergrootte op een geeltje, gezet door buildStickies()
let scale = 1;
let generation = 0;       // verhoogd bij elke navigatie; oude animatiestappen stoppen dan
let loadedTitle = '';      // de titel van de presentatie zoals geladen, om een wijziging te herkennen
let loadedGoals = '[]';     // de doelen zoals geladen (JSON), om wijzigingen te herkennen
let textEditor = null;   // het tekstvak van de bewerkmodus (vel of werkafspraken), zolang het open is (zie openTextEditor)
// Wijzigingen (alleen in het geheugen) gaan direct in het model: tips die tijdens de presentatie
// worden toegevoegd (type tip, user: true), en alles uit de bewerkmodus. De export schrijft de
// vellen altijd uit het model (zie contentWithChanges). Voor de telling op het afsluitscherm:
const original = new Map();        // item uit de inhoud → JSON zoals geladen (om bewerkingen te tellen)
const originalSheets = new Map();  // vel uit de inhoud → { title, order, topic } zoals geladen (toegevoegd, verwijderd, hernoemd, verplaatst)
const originalTopics = new Map();  // onderwerp uit de inhoud → { index in de JSON, naam zoals geladen }
// ?demo: de voorbeeldinhoud (content.example.json, staat onversleuteld in de repository), zonder
// wachtwoord, altijd live en zonder export. Gaat voor ?edit: met ?demo in de adresbalk telt die niet.
const demoMode = new URLSearchParams(location.search).has('demo');
const editMode = new URLSearchParams(location.search).has('edit') && !demoMode;

/* ------------------------------------------------------------------ */
/* Laden en ontsleutelen                                               */
/* ------------------------------------------------------------------ */

// De sleutel van de geladen inhoud (niet het wachtwoord); daarmee worden de afbeeldingen
// (img/naam.enc.png) ontsleuteld. null in de demo.
let contentKey = null;

async function loadContent(password) {
  if (demoMode) {
    // Vaste bestandsnaam: de demo laadt nooit iets anders dan het openbare voorbeeld.
    const r = await fetch('content.example.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('De demo kon niet worden geladen (' + r.status + ').');
    return r.json();
  }
  const r = await fetch('content.enc.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('De presentatie kon niet worden geladen (' + r.status + ').');
  const payload = await r.json();
  const key = await payloadKey(payload, password);
  const raw = JSON.parse(await decryptTextWith(payload, key));
  contentKey = key;
  return raw;
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  warmUpAudio(); // nu, tijdens het inloggen, in plaats van bij het eerste geluid
  const button = els.form.querySelector('button');
  button.disabled = true;
  els.loginError.textContent = '';
  try {
    const raw = await loadContent(els.password.value);
    els.password.value = '';
    start(raw);
  } catch (err) {
    els.loginError.textContent = err instanceof WrongPasswordError ? 'Onjuist wachtwoord.' : err.message;
    els.password.select();
  } finally {
    button.disabled = false;
  }
});

// Het loginscherm toont de link naar de demo, behalve in de bewerkmodus (de demo is altijd live).
els.demoLink.hidden = editMode;
if (demoMode) document.getElementById('demo-badge').hidden = false;

// Het wachtwoordveld krijgt pas focus als het loginscherm echt getoond wordt (geen autofocus in de
// HTML): in de demo zou een schermlezer anders bij het openen naar de invoermodus schakelen.
if (!demoMode) els.password.focus();

if (demoMode) {
  loadContent().then(start).catch((err) => { els.loginError.textContent = err.message; });
}

/* ------------------------------------------------------------------ */
/* Opstarten                                                           */
/* ------------------------------------------------------------------ */

function start(raw) {
  // Het model is een kopie, zodat raw het origineel blijft om mee te vergelijken.
  const { content, problems, errors } = normalizeContent(structuredClone(raw));
  for (const p of problems) console.warn(p);
  // Fouten (zoals een vel zonder titel) tonen we toch, zodat je kunt doorwerken; versleuteld
  // exporteren en tools/encrypt.js weigeren ze wel.
  for (const e of errors) console.error(e);
  rawContent = raw;
  deck = content;
  document.title = deck.title;
  // De titel uit de JSON ook op het startscherm, onder "WELKOM" (zonder title in de JSON: niets).
  // In de bewerkmodus altijd, zodat hij te bewerken is (zonder titel in de JSON: "Presentatie").
  const subtitle = els.startSubtitle;
  const shownTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  setEditableText(subtitle, shownTitle || (editMode ? deck.title : ''));
  subtitle.hidden = subtitle.textContent === '';
  loadedTitle = deck.title;

  rebuildFlat();
  deck.topics.forEach((topic, t) => originalTopics.set(topic, { index: t, name: topic.sticky }));
  for (const f of flat) originalSheets.set(f.model, { title: f.title, order: originalSheets.size, topic: deck.topics[f.topic] });
  for (const f of flat) for (const step of f.steps) for (const item of step) original.set(item, JSON.stringify(item));

  // Afbeeldingen alvast laden, zodat ophangen meteen kan (zie loadImage)
  for (const f of flat) for (const step of f.steps) for (const item of step) if (item.type === 'pin') loadImage(item.image);

  // Werkafspraken (standaard verborgen; zonder afspraken ook geen knop)
  renderAgreements();

  // Doelen bovenaan het whiteboard (zie buildGoals)
  loadedGoals = JSON.stringify(deck.goals);
  buildGoals();

  els.login.hidden = true;
  els.viewport.hidden = false;
  fitStage();
  buildStickies(); // pas nu: de beschikbare ruimte in de kolom wordt gemeten
  fitStickyText(stickyFontPx);

  pos = readHash() || START; // zonder positie in de adresbalk: het startscherm
  render(null);
  // Opnieuw passen zodra de handschriftlettertypen geladen zijn (die hebben andere maten
  // dan het vervangende lettertype, waardoor lijsten anders te klein uitvallen).
  document.fonts?.ready.then(refitText);
}

/**
 * Bouwt de platte lijst van vellen (flat) opnieuw op uit het model: bij het laden, en na het
 * toevoegen, verwijderen of verplaatsen van een vel of onderwerp. De steps zijn dezelfde lijsten
 * als in het model.
 */
function rebuildFlat() {
  flat = [];
  firstSheetOfTopic = [];
  deck.topics.forEach((topic, t) => {
    firstSheetOfTopic[t] = flat.length;
    topic.sheets.forEach((sheet, s) => flat.push({ topic: t, sheet: s, title: sheet.title, steps: sheet.steps, model: sheet }));
  });
}

/**
 * Zet de tekst van iets wat je in de bewerkmodus kunt aanklikken om te bewerken (de titel van een
 * vel, de titel van de presentatie). In de bewerkmodus staat de tekst in een echte knop: die is met
 * Tab te bereiken, en Enter en spatie doen daarop (door de browser) hetzelfde als een klik.
 */
function setEditableText(el, text) {
  if (!editMode) { el.textContent = text; return; }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'edit-text-btn';
  button.textContent = text;
  button.title = 'Titel bewerken';
  el.replaceChildren(button);
}

/** Past alle tekstgroottes opnieuw aan de beschikbare ruimte aan. */
function refitText() {
  if (els.stage.hidden) return; // er valt niets te meten; showStage() past alles opnieuw
  fitGoals(); // eerst: de hoogte van de strook bepaalt de ruimte voor de geeltjes
  applyStickySize();
  fitStickyText(stickyFontPx);
  fitList(els.tipsSheet, els.tipsList, LIST_FONT_MAX, 18);
  fitList(els.keywordSheet, els.keywordSheet.querySelector('ul'), LIST_FONT_MAX, 20);
  if (!els.question.hidden) fitQuestion();
  fitAgreements();
}

/**
 * Kiest het formaat van de geeltjes zo dat alle onderwerpen in één kolom passen (To do aan
 * het begin, Done aan het eind), zo groot en breed mogelijk: brede geeltjes houden lange
 * woorden leesbaar. Meet aan het bord zelf (niet aan de inhoud van de kolom), dus aanroepen
 * terwijl het podium zichtbaar is, en opnieuw als de lettertypen geladen zijn: de hoogte van
 * de kolomkoppen, en dus de ruimte voor de geeltjes, hangt daarvan af.
 */
function stickySize(n) {
  const GAP = 10, MAX_W = 104, MAX_H = 80;
  const cards = els.cols.todo; // .kb-cards; offsetTop is gemeten vanaf de kolom (position: relative)
  const width = els.kanban.clientWidth / 3 - 16;                // min padding van .kb-col
  const height = els.kanban.clientHeight - cards.offsetTop - 4; // min kop en padding-top
  let size;
  for (const per of [2, 3, 4]) {
    const rows = Math.ceil(n / per);
    const w = Math.min(MAX_W, Math.floor((width - (per - 1) * GAP) / per));
    const h = Math.min(MAX_H, Math.round(w * 0.8), Math.floor((height - (rows - 1) * GAP) / rows));
    size = { w, h, per, font: Math.max(11, Math.round(h * 0.275)) };
    if (h >= w * 0.55) break; // niet platter dan dit; anders meer geeltjes per rij
  }
  return size;
}

function applyStickySize() {
  const size = stickySize(deck.topics.length);
  const root = document.documentElement.style;
  root.setProperty('--sw', size.w + 'px');
  root.setProperty('--sh', size.h + 'px');
  root.setProperty('--sfont', size.font + 'px');
  root.setProperty('--sper', size.per);
  stickyFontPx = size.font;
}

function buildStickies() {
  for (const b of stickies) b.remove(); // opnieuw opbouwen (na toevoegen of verwijderen van een onderwerp)
  applyStickySize();

  const rotations = [-3, 2, -1.5, 3, -2.5, 1, 2.5, -1, 1.5, -2];
  stickies = deck.topics.map((topic, t) => {
    const b = document.createElement('button');
    b.className = 'sticky';
    b.type = 'button';
    b.dataset.topic = t;
    b.title = 'Ga naar: ' + topic.sticky;
    b.style.setProperty('--rot', rotations[t % rotations.length] + 'deg');
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = topic.sticky;
    b.append(note);
    b.addEventListener('click', () => {
      // In de bewerkmodus is het geeltje in Doing (het huidige onderwerp) de plek om de naam te wijzigen.
      if (editMode && isContent(pos) && flat[pos.sheet].topic === t) return editTopicName();
      b.blur(); // de focus niet op het geeltje laten staan
      goTo({ sheet: firstSheetOfTopic[t], step: 0 });
    });
    return b;
  });
  for (const b of stickies) els.cols.todo.append(b);
}

/** Verkleint de tekst op een geeltje als die er niet op past. */
function fitStickyText(maxPx) {
  for (const b of stickies) {
    const note = b.querySelector('.note');
    let size = maxPx;
    note.style.fontSize = size + 'px';
    while ((note.scrollWidth > note.clientWidth || note.scrollHeight > note.clientHeight) && size > 9) {
      size -= 1;
      note.style.fontSize = size + 'px';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Afgeleide toestand                                                  */
/* ------------------------------------------------------------------ */

// Vóór de inhoud (sheet === -1) staat het startscherm, erna (sheet === flat.length) het
// afsluitscherm. De eerste inhoud is { 0, 0 }; de laatste inhoud: alle steps van het laatste vel.
const START = { sheet: -1, step: 0 };
const isStart = (p) => p.sheet < 0;
const isEnd = (p) => p.sheet >= flat.length;
const isContent = (p) => !isStart(p) && !isEnd(p);
const firstContent = () => ({ sheet: 0, step: 0 });
const lastContent = () => ({ sheet: flat.length - 1, step: flat[flat.length - 1].steps.length });
const isLastContent = (p) => p.sheet === flat.length - 1 && p.step === flat[p.sheet].steps.length;
const topicAt = (p) => (isStart(p) ? -1 : isEnd(p) ? deck.topics.length : flat[p.sheet].topic);

// Eigenschappen van een keyword, met de standaard bij een ontbrekende of ongeldige waarde.
const colorOf = (item) => (KEYWORD_COLORS.has(item.color) ? item.color : undefined);
const indentOf = (item) => (KEYWORD_INDENTS.includes(item.indent) ? item.indent : 0);
const gapOf = (item) => (KEYWORD_GAPS.has(item.gap) ? item.gap : undefined);

/** De titel van het vel op positie p (leeg op het start- en afsluitscherm). */
const titleAt = (p) => (isContent(p) ? flat[p.sheet].title : '');

/** Alle items van de uitgevoerde steps van het huidige vel, in volgorde. */
const shownItems = (p) => (isContent(p) ? flat[p.sheet].steps.slice(0, p.step).flat() : []);

// Regels op de flip-overs: { text, …eigenschappen }.
function keywordsAt(p) {
  return shownItems(p).filter((it) => it.type === 'keyword').map((it) => ({
    text: it.text, color: colorOf(it), indent: indentOf(it), numbered: it.numbered === true, gap: gapOf(it),
  }));
}

/**
 * Alle tips tot en met positie p, in volgorde (tips blijven staan over de vellen heen). ref is het
 * item in het model: in de bewerkmodus zegt een klik op een tip op welk vel die staat.
 */
function tipsAt(p) {
  const out = [];
  const last = Math.min(p.sheet, flat.length);
  const push = (it) => { if (it.type === 'tip') out.push({ text: it.text, user: it.user === true, ref: it }); };
  for (let i = 0; i < last; i++) for (const step of flat[i].steps) step.forEach(push);
  shownItems(p).forEach(push);
  return out;
}

/**
 * De doelen die tot en met positie p zijn afgevinkt (ids). Een vinkje blijft staan, ook op latere
 * vellen; terugbladeren tot vóór de klik met het "check"-item haalt het weer weg.
 */
function checkedGoalsAt(p) {
  const out = new Set();
  const take = (it) => { if (it.type === 'check') out.add(it.goal); };
  for (let i = 0; i < Math.min(p.sheet, flat.length); i++) for (const step of flat[i].steps) step.forEach(take);
  shownItems(p).forEach(take);
  return out;
}

/**
 * De afbeelding die op positie p op het whiteboard hangt (het pin-item), of null. De laatste
 * pin of unpin tot en met p telt, ook van eerdere vellen: een afbeelding blijft hangen tot hij
 * wordt weggehaald of vervangen.
 */
function pinnedAt(p) {
  let out = null;
  const take = (it) => { if (it.type === 'pin') out = it; else if (it.type === 'unpin') out = null; };
  for (let i = 0; i < Math.min(p.sheet, flat.length); i++) for (const step of flat[i].steps) step.forEach(take);
  shownItems(p).forEach(take);
  return out;
}

/** De huidige step (die van de laatste klik), of null. */
const currentStep = (p) => (isContent(p) && p.step > 0 ? flat[p.sheet].steps[p.step - 1] : null);

/** De vraag van de huidige step, of null. Een vraag staat er alleen zolang zijn step de huidige is. */
const questionItemAt = (p) => currentStep(p)?.find((it) => it.type === 'question') ?? null;
const questionAt = (p) => questionItemAt(p)?.text ?? null;

function columnFor(t, current) {
  return t < current ? 'done' : t === current ? 'doing' : 'todo';
}

/* ------------------------------------------------------------------ */
/* Navigatie                                                           */
/* ------------------------------------------------------------------ */

function next() {
  if (isEnd(pos)) return;
  if (isStart(pos)) return goTo(firstContent());
  const len = flat[pos.sheet].steps.length;
  goTo(pos.step < len ? { sheet: pos.sheet, step: pos.step + 1 } : { sheet: pos.sheet + 1, step: 0 });
}

function prev() {
  if (isStart(pos)) return; // op het startscherm werkt alleen "Start"
  if (pos.step > 0) return goTo({ sheet: pos.sheet, step: pos.step - 1 });
  if (pos.sheet > 0) return goTo({ sheet: pos.sheet - 1, step: flat[pos.sheet - 1].steps.length });
  goTo(START); // vanaf de eerste inhoud terug naar het startscherm
}

/**
 * Per vel bladeren (Shift+pijl links/rechts, Shift+PgUp/PgDn en de knoppen « en »). Vorig vel: midden op een vel eerst naar het
 * begin ervan, aan het begin naar het begin van het vorige vel. Volgend vel: naar het begin van
 * het volgende vel. Nooit naar het start- of afsluitscherm; vanaf het startscherm gaat "volgend
 * vel" naar het eerste vel, vanaf het afsluitscherm "vorig vel" naar het begin van het laatste.
 */
function prevSheet() {
  if (isStart(pos)) return;
  if (isEnd(pos)) return goTo({ sheet: flat.length - 1, step: 0 });
  if (pos.step > 0) return goTo({ sheet: pos.sheet, step: 0 });
  if (pos.sheet > 0) goTo({ sheet: pos.sheet - 1, step: 0 });
}

function nextSheet() {
  if (isEnd(pos)) return;
  if (isStart(pos)) return goTo(firstContent());
  if (pos.sheet < flat.length - 1) goTo({ sheet: pos.sheet + 1, step: 0 });
}

function goTo(target) {
  if (textEditor) return; // eerst opslaan of annuleren
  if (target.sheet === pos.sheet && target.step === pos.step) return;
  const previous = pos;
  pos = target;
  render(previous);
}

/* ------------------------------------------------------------------ */
/* Weergave                                                            */
/* ------------------------------------------------------------------ */

function render(previous) {
  const my = ++generation;
  hidePointer(false); // elke verandering haalt de aanwijzer weg
  finishAllAnimations();
  cancelQueuedSounds();
  const animate = previous !== null;

  // Podium terug vóór er iets gemeten wordt, of meteen onbereikbaar op een donker scherm
  if (isContent(pos)) showStage(); else blockStage();

  // Geluiden in een vaste volgorde, na elkaar (zie queueSound): eerst het geritsel van een
  // nieuw vel, dan de vraagtoon, dan het belletje van een nieuwe tip.
  const sheetTurned = previous !== null && previous.sheet !== pos.sheet && isContent(previous) && isContent(pos);
  const question = questionAt(pos);
  const goalsDone = checkedGoalsAt(pos);
  const newlyChecked = previous === null ? [] : [...goalsDone].filter((id) => !checkedGoalsAt(previous).has(id));
  if (sheetTurned) playPageTurn();
  // Afbeelding ophangen, vervangen of weghalen: na het geritsel, vóór de vraagtoon. De beweging
  // begint tegelijk met het geluid.
  const pinned = pinnedAt(pos);
  const pinChanged = previous !== null && pinned !== pinnedAt(previous);
  const pinAt = !pinChanged ? 0 : pinned ? playPinUp() : playPinDown();
  renderPin(pinned, animate && pinChanged, pinAt);
  if (previous !== null && question !== null) playQuestionTone();
  const tipsAdded = previous !== null && tipsAt(pos).length > tipsAt(previous).length;
  if (tipsAdded) playBell();
  // Voorlezen wat deze klik laat verschijnen, in één melding en in een vaste volgorde: de vraag,
  // het blaadje, de nieuwe tips. Alleen de tips van de huidige klik: een sprong naar een ander
  // onderwerp begint op een leeg vel en leest dus niet alle tips van de tussenliggende vellen voor.
  // Zonder iets nieuws wordt de voorleesregel leeggemaakt.
  announce([
    previous !== null && question !== null ? question : null,
    pinChanged && pinned ? 'Blaadje: ' + pinned.text : null,
    ...(tipsAdded ? (currentStep(pos) ?? []).filter((it) => it.type === 'tip').map((it) => 'Tip: ' + it.text) : []),
  ]);
  // Het vinkje wordt getekend op het moment dat het schrijfgeluid klinkt (dat kan na de andere zijn).
  const checkAt = newlyChecked.length ? playCheck() : 0;
  renderGoals(goalsDone, animate ? newlyChecked : [], checkAt);

  // Tips links
  renderTips(animate);

  // Steekwoorden rechts (met omslaand vel als het vel verandert). Niet van of naar het start-
  // of afsluitscherm: dan valt er niets om te slaan.
  if (sheetTurned && animate) turnSheet(pos.sheet > previous.sheet);
  setEditableText(els.keywordTitle, titleAt(pos));
  setList(els.keywordSheet.querySelector('ul'), keywordsAt(pos), animate && previous.sheet === pos.sheet);
  fitList(els.keywordSheet, els.keywordSheet.querySelector('ul'), LIST_FONT_MAX, 20);

  // Vraag op het whiteboard
  showQuestion(question, animate);

  // Geeltjes. Niet alles tegelijk: bij een nieuw vel eerst (grotendeels) omslaan, en vanaf het
  // startscherm eerst het donkere scherm laten wegfaden. Naar het afsluitscherm verspringen ze
  // stil, want het bord is dan niet te zien.
  const stickyDelay = !animate ? 0 : sheetTurned ? STICKY_AFTER_TURN : isStart(previous) ? 300 : 0;
  moveStickies(topicAt(pos), animate && isContent(pos), my, stickyDelay);

  // Start- en afsluitscherm; de bediening krijgt daar de donkere stijl en blijft zichtbaar
  showDarkScreen(els.startScreen, isStart(pos), animate, hideStage);
  showDarkScreen(els.endScreen, isEnd(pos), animate, hideStage);
  els.controls.classList.toggle('on-dark', !isContent(pos));

  updateHash();
  updateProgress();
  updateButtons();
  updateDownload();
}

/* ---------- Afbeelding op het whiteboard ---------- */
// Een vel papier met twee ronde magneten, over de doelen en het kanbanbord (niet over de
// vraagzone; de werkafspraken komen er wel overheen). Het papier is A4 of A5, staand of liggend
// naar de verhouding van de afbeelding, en altijd even groot: A4 is A4, waar de afbeelding ook
// vandaan komt. De afbeelding wordt erop gecentreerd en passend geschaald. De beschrijving
// (text) is alleen de alt-tekst. Ophangen: het vel komt tegen het bord, daarna klikken de
// magneten erop; weghalen: eerst de magneten eraf, dan het vel.

/**
 * naam → { ok: true, url, w, h, bytes, ext } | { ok: false, why } | Promise zolang hij laadt.
 * bytes: de onversleutelde afbeelding (voor de export), ext: png of jpg.
 */
const images = new Map();

/**
 * Waar een afbeelding staat, in volgorde van zoeken: [pad, ext, versleuteld].
 * - demo: img_demo/naam.png of .jpg (openbaar, onversleuteld);
 * - anders: img/naam.enc.png of .enc.jpg (versleuteld met de sleutel van de inhoud);
 * - alleen in de bewerkmodus daarna ook img/naam.png of .jpg: een nieuwe afbeelding die nog niet
 *   versleuteld is (de export versleutelt hem). Live nooit, zodat een vergeten afbeelding opvalt.
 */
function imageSources(name) {
  if (demoMode) return [[`img_demo/${name}.png`, 'png', false], [`img_demo/${name}.jpg`, 'jpg', false]];
  const out = [[`img/${name}.enc.png`, 'png', true], [`img/${name}.enc.jpg`, 'jpg', true]];
  if (editMode) out.push([`img/${name}.png`, 'png', false], [`img/${name}.jpg`, 'jpg', false]);
  return out;
}

/**
 * Laadt een afbeelding (zie imageSources), één keer per naam. Daarna wordt een vel dat al hangt
 * (met een tijdelijk leeg papier) bijgewerkt.
 */
function loadImage(name) {
  if (images.has(name)) return;
  images.set(name, (async () => {
    const sources = imageSources(name);
    let found = null;
    let why = `niet gevonden: ${sources.map(([path]) => path).join(' of ')}`;
    for (const [path, ext, encrypted] of sources) {
      try {
        let r, bytes;
        try {
          r = await fetch(path, { cache: 'no-store' });
          if (r.ok) bytes = new Uint8Array(await r.arrayBuffer());
        } catch {
          why = `${path} kon niet worden geladen (verbinding verbroken?)`;
          continue;
        }
        if (!r.ok) continue;
        if (encrypted) bytes = await decryptBytes(bytes, contentKey);
        const url = URL.createObjectURL(new Blob([bytes], { type: ext === 'png' ? 'image/png' : 'image/jpeg' }));
        const img = new Image();
        img.src = url;
        await img.decode(); // ook: is het wel een afbeelding?
        found = { ok: true, url, w: img.naturalWidth, h: img.naturalHeight, bytes, ext };
        break;
      } catch (err) {
        why = err instanceof WrongPasswordError ? `${path} past niet bij dit wachtwoord` : `${path} is geen (geldige) afbeelding`;
      }
    }
    if (!found) console.error(`Afbeelding "${name}" ${why}.`);
    if (images.get(name) instanceof Promise) images.set(name, found ?? { ok: false, why }); // niet als er intussen geüpload is
    if (pinShown?.image === name) renderPin(pinShown, false, 0, true);
    if (els.imagesDialog.open) renderImagesList();
  })());
}

let pinShown = null; // het pin-item dat nu hangt (of null)

/** Kleine, vaste scheefstand per afbeelding (−1,6° tot 1,6°): elk vel hangt net anders. */
function tiltOf(name) {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ((h % 33) - 16) / 10;
}

/**
 * Het formaat als de inhoud het niet zegt: het grootste waarop de afbeelding nog scherp is.
 * Liggend en minstens 1600 pixels breed: A3; een lange zijde van minstens 1000 pixels: A4;
 * kleiner: A5. (Een liggende A4 is op een 1920 pixels breed scherm zo'n 520 pixels breed.)
 */
const autoPaper = ({ w, h }) => (w >= h && w >= 1600 ? 'A3' : Math.max(w, h) >= 1000 ? 'A4' : 'A5');

const warnedA3 = new Set(); // elke staande A3 één keer melden

/** Papier en stand voor een pin-item. Zolang de afbeelding laadt: A4 liggend (of wat er staat). */
function paperOf(item, info) {
  const portrait = info?.ok === true && info.h > info.w;
  let paper = item.paper ?? (info?.ok ? autoPaper(info) : 'A4');
  if (paper === 'A3' && portrait) {
    if (!warnedA3.has(item)) console.warn(`Afbeelding "${item.image}" is staand en A3 bestaat alleen liggend: A4 staand gebruikt.`);
    warnedA3.add(item);
    paper = 'A4';
  }
  return { paper, orient: portrait ? 'portrait' : 'landscape' };
}

/** Het vel papier voor een pin-item, met afbeelding (of een melding) en twee magneten. */
function pinPaper(item) {
  const info = images.get(item.image);
  const paper = document.createElement('div');
  paper.className = 'pin-paper';
  const size = paperOf(item, info);
  paper.dataset.paper = size.paper;
  paper.dataset.orient = size.orient;
  paper.style.transform = `rotate(${tiltOf(item.image)}deg)`;
  if (info?.ok) {
    const img = document.createElement('img');
    img.src = info.url;
    img.alt = item.text;
    img.draggable = false;
    paper.append(img);
  } else {
    // Laadt nog (leeg papier), of ontbreekt (een melding, zodat je het tijdens het voorbereiden ziet)
    const note = document.createElement('p');
    note.className = 'pin-missing';
    note.textContent = info?.ok === false ? `Afbeelding "${item.image}" ${info.why}` : '';
    note.setAttribute('role', 'img');
    note.setAttribute('aria-label', item.text);
    paper.append(note);
  }
  for (const side of ['left', 'right']) {
    const magnet = document.createElement('i');
    magnet.className = 'magnet magnet-' + side;
    magnet.setAttribute('aria-hidden', 'true');
    paper.append(magnet);
  }
  return paper;
}

/**
 * Hangt item op (of haalt de afbeelding weg met null). animated: met beweging, na delay ms
 * (gelijk met het geluid). force: opnieuw opbouwen, ook als hetzelfde item al hangt.
 */
function renderPin(item, animated, delay, force = false) {
  if (item === pinShown && !force) return;
  pinShown = item;
  const layer = els.pinLayer;
  // Het gebied "Blaadje" bestaat alleen zolang er iets hangt (een leeg gebied is ruis voor schermlezers)
  if (item) layer.setAttribute('role', 'region'); else layer.removeAttribute('role');
  const old = [...layer.querySelectorAll('.pin-paper:not(.leaving)')];
  const paper = item ? pinPaper(item) : null;
  if (!animated) {
    layer.replaceChildren(...(paper ? [paper] : []));
    return;
  }
  for (const el of old) unpinPaper(el, delay);
  if (!paper) return;
  layer.append(paper);
  const tilt = tiltOf(item.image);
  animate(paper, [
    { opacity: 0, transform: `translate(-6px, -22px) rotate(${tilt + 2.5}deg) scale(1.03)`, boxShadow: '0 22px 30px rgba(0,0,0,.18)' },
    { opacity: 1, offset: 0.35 },
    { opacity: 1, transform: `rotate(${tilt}deg)`, boxShadow: '' },
  ], { duration: 260, delay, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'backwards' });
  // De magneten klikken erop: op het moment van de klikjes in pinUpSound (0,26 en 0,41 s).
  paper.querySelectorAll('.magnet').forEach((magnet, i) => {
    animate(magnet, [
      { opacity: 0, transform: 'translate(3px, -16px) scale(1.35)' },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ], { duration: 110, delay: delay + 150 + i * 150, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'backwards' });
  });
}

/** Haalt een vel weg: eerst de magneten (een voor een), dan zakt het vel en verdwijnt. */
function unpinPaper(paper, delay) {
  paper.classList.add('leaving');
  paper.querySelectorAll('.magnet').forEach((magnet, i) => {
    animate(magnet, [
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
      { opacity: 0, transform: 'translate(2px, -12px) scale(1.2)' },
    ], { duration: 100, delay: delay + i * 70, easing: 'ease-in', fill: 'forwards' });
  });
  const from = paper.style.transform;
  animate(paper, [
    { opacity: 1, transform: from },
    { opacity: 0, transform: from + ' translate(4px, 18px)' },
  ], { duration: 190, delay: delay + 150, easing: 'ease-in', fill: 'forwards' }, () => paper.remove());
}

/** Een donker scherm (start of einde) tonen of verbergen; onShown volgt als het volledig in beeld is. */
function showDarkScreen(screen, show, animated, onShown) {
  if (show && !screen.hidden) return onShown();
  if (!show && screen.hidden) return;
  if (show) {
    screen.hidden = false;
    if (animated) animate(screen, [{ opacity: 0 }, { opacity: 1 }], { duration: 400, easing: 'ease-out' }, onShown);
    else onShown();
  } else if (animated) {
    animate(screen, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-in' }, () => { screen.hidden = true; });
  } else {
    screen.hidden = true;
  }
}

/*
 * Op het start- en afsluitscherm is het podium (whiteboard en flip-overs) niet alleen
 * afgedekt maar echt weg: niet getekend, niet in de toegankelijkheidsboom, niet met Tab of
 * zoeken (Ctrl+F) te bereiken. Bij het verschijnen van een donker scherm wordt het podium
 * meteen onbereikbaar (blockStage) en pas onzichtbaar als het scherm volledig is ingefade
 * (hideStage), zodat de overgang mooi blijft.
 */
function blockStage() {
  els.stage.inert = true;
  els.stage.setAttribute('aria-hidden', 'true');
}

function hideStage() {
  blockStage();
  els.stage.hidden = true;
}

function showStage() {
  const stage = els.stage;
  stage.inert = false;
  stage.removeAttribute('aria-hidden');
  if (stage.hidden) {
    stage.hidden = false;
    refitText(); // tijdens het verbergen kon er niets gemeten worden
  }
}

/**
 * Op het startscherm is "volgende" de knop "Start" (en werkt "vorige" niet), op de laatste
 * inhoud is het "Einde", en op het afsluitscherm kan niet verder.
 */
function updateButtons() {
  const b = els.next;
  const label = isStart(pos) ? 'Start' : isLastContent(pos) ? 'Einde' : null;
  b.classList.toggle('labeled', label !== null);
  const editing = textEditor !== null; // zolang een tekstvak open is: niet bladeren (zie goTo)
  b.disabled = isEnd(pos) || editing;
  b.textContent = label ? label + ' ›' : '›';
  b.title = isStart(pos) ? 'Presentatie starten (→)' : label ? 'Naar het afsluitscherm (→)' : 'Volgende (→)';
  els.prev.disabled = isStart(pos) || editing;
  els.prevSheet.disabled = editing || isStart(pos) || (isContent(pos) && pos.sheet === 0 && pos.step === 0);
  els.nextSheet.disabled = editing || isEnd(pos) || (isContent(pos) && pos.sheet === flat.length - 1);
  const currentTopic = isContent(pos) ? flat[pos.sheet].topic : -1;
  stickies.forEach((sticky, t) => {
    sticky.disabled = editing;
    sticky.title = editMode && t === currentTopic ? 'Naam van dit onderwerp wijzigen' : 'Ga naar: ' + deck.topics[t].sticky;
  });
  els.editBtn.disabled = !isContent(pos) || editing; // niets te bewerken op het start- of afsluitscherm
  els.agreementsBtn.disabled = !isContent(pos) || editing;
  els.agreementsEditBtn.disabled = !isContent(pos) || editing;
  els.imagesBtn.disabled = editing;
  els.addSheetBtn.disabled = !isContent(pos) || editing;
  updateMoveButtons(editing);
  const full = deck.topics.length >= TOPICS_MAX;
  els.addTopicBtn.disabled = !isContent(pos) || editing || full;
  els.addTopicBtn.title = full ? `Er passen hooguit ${TOPICS_MAX} onderwerpen` : 'Nieuw onderwerp na dit onderwerp';
  const onlyTopic = deck.topics.length === 1;
  els.deleteTopicBtn.disabled = !isContent(pos) || editing || onlyTopic;
  els.deleteTopicBtn.title = onlyTopic ? 'Er moet altijd minstens één onderwerp zijn' : 'Dit onderwerp verwijderen';
  const onlySheet = isContent(pos) && deck.topics[flat[pos.sheet].topic].sheets.length === 1;
  const lastSheet = onlySheet && deck.topics.length === 1;
  els.deleteSheetBtn.disabled = !isContent(pos) || editing || lastSheet;
  els.deleteSheetBtn.title = lastSheet ? 'Het enige vel van de presentatie kan niet weg'
    : onlySheet ? 'Dit vel verwijderen; het onderwerp verdwijnt dan ook' : 'Dit vel verwijderen';
  const addGoalBtn = els.goals.querySelector('.goal-add-btn');
  if (addGoalBtn) addGoalBtn.disabled = !isContent(pos) || editing;
}

/**
 * Bouwt de doelenstrook: per doel een vakje (met een nog onzichtbaar vinkje) en de tekst. Voor
 * schermlezers staat de toestand er als tekst bij. In de bewerkmodus krijgt elk doel ook zijn
 * code (+doel1, zichtbaar bij aanwijzen, focus en bewerken) en, als er minder dan GOALS_MAX
 * doelen zijn, het eerstvolgende vak een knop "+ Doel toevoegen". Daarna de vinkjes opnieuw.
 * Na een wijziging in de bewerkmodus ook refitText(): de strook kan hoger of lager zijn.
 */
function buildGoals() {
  const items = deck.goals.map((goal) => {
    const li = document.createElement('li');
    li.className = 'goal';
    li.dataset.goal = goal.id;
    li.innerHTML = '<span class="goal-box" aria-hidden="true"><svg class="goal-check" viewBox="0 0 40 40"><path d="M7 22 L16 31 L35 6"/></svg></span>';
    const text = document.createElement(editMode ? 'button' : 'span'); // bewerkmodus: met Tab bereikbaar
    text.className = 'goal-text';
    if (editMode) text.type = 'button';
    text.textContent = goal.text;
    const state = document.createElement('span');
    state.className = 'sr-only';
    li.append(state, text); // de toestand vóór de tekst: een schermlezer leest eerst (x)
    if (editMode) {
      li.append(goalCode(goal.id));
      text.setAttribute('aria-describedby', 'goal-code-' + goal.id);
      text.title = 'Doel bewerken';
    }
    return li;
  });
  if (editMode && deck.goals.length < GOALS_MAX) {
    const id = GOAL_IDS[deck.goals.length];
    const li = document.createElement('li');
    li.className = 'goal goal-add';
    li.dataset.slot = id;
    li.innerHTML = '<span class="goal-box" aria-hidden="true"></span>';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'goal-add-btn';
    button.textContent = '+ Doel toevoegen';
    button.title = 'Doel toevoegen';
    button.setAttribute('aria-describedby', 'goal-code-' + id);
    li.append(button, goalCode(id));
    items.push(li);
  }
  els.goals.replaceChildren(...items);
  els.goals.hidden = items.length === 0;
  document.getElementById('goals-region').hidden = items.length === 0; // geen doelen: ook geen gebied
  if (isContent(pos)) renderGoals(checkedGoalsAt(pos), [], 0);
}

/** De code van een doel (+doel1) zoals je hem in een vel typt; alleen in de bewerkmodus. */
function goalCode(id) {
  const code = document.createElement('span');
  code.className = 'goal-code';
  code.id = 'goal-code-' + id;
  code.textContent = '+' + id;
  return code;
}

// De doelenstrook mag niet te hoog worden, anders schuift het kanbanbord weg: hooguit drie regels
// per rij bij de gewone lettergrootte. Daarboven krimpen de letters, tot GOALS_FONT_MIN.
const GOALS_FONT = 27;      // px
const GOALS_FONT_MIN = 22;  // px: op een laptop van 1920×1080 nog goed leesbaar
const GOALS_MAX_HEIGHT = 2 * 3 * Math.ceil(GOALS_FONT * 1.15) + 6 + 2; // twee rijen van drie regels, gap en padding

/** Verkleint de letters van de doelen tot de strook niet hoger is dan GOALS_MAX_HEIGHT. */
function fitGoals() {
  const ul = els.goals;
  if (ul.hidden || els.stage.hidden) return;
  let size = GOALS_FONT;
  ul.style.setProperty('--goal-font', size + 'px');
  while (ul.offsetHeight > GOALS_MAX_HEIGHT && size > GOALS_FONT_MIN) {
    size -= 1;
    ul.style.setProperty('--goal-font', size + 'px');
  }
}

/**
 * Zet de vinkjes bij de doelen. Een net afgevinkt doel krijgt zijn vinkje "getekend" (na delay
 * ms, gelijk met het schrijfgeluid); de rest staat er meteen of verdwijnt meteen.
 */
function renderGoals(checked, drawIds, delay) {
  for (const li of els.goals.children) {
    if (!li.dataset.goal) continue; // het vak "+ Doel toevoegen" (bewerkmodus)
    const on = checked.has(li.dataset.goal);
    li.classList.toggle('checked', on);
    li.querySelector('.sr-only').textContent = on ? '(x) ' : '';
    if (on && drawIds.includes(li.dataset.goal)) {
      animate(li.querySelector('.goal-check path'), [
        { strokeDashoffset: 60 },
        { strokeDashoffset: 42, offset: 0.3 },  // korte streek naar beneden
        { strokeDashoffset: 0 },                 // lange streek omhoog
      ], { duration: 330, delay, easing: 'ease-in-out', fill: 'backwards' });
    }
  }
}

function renderTips(animate) {
  setList(els.tipsList, tipsAt(pos), animate);
  fitList(els.tipsSheet, els.tipsList, LIST_FONT_MAX, 18);
}

/**
 * Laat een schermlezer voorlezen wat er verschijnt (de voorleesregel is een aria-live-regio), als
 * één melding: losse meldingen kort na elkaar breken elkaar af. Lege delen vallen weg; een deel
 * zonder leesteken aan het eind krijgt een punt, zodat de schermlezer er een pauze houdt. Eerst
 * leegmaken en pas daarna vullen, zodat ook dezelfde tekst nog eens wordt voorgelezen.
 */
function announce(parts) {
  const el = els.announcer;
  const text = parts.filter(Boolean).map((p) => (/[.?!…]$/.test(p) ? p : p + '.')).join(' ');
  el.textContent = '';
  if (text) setTimeout(() => { el.textContent = text; }, 50);
}

/**
 * Eén regel op een flip-over. Een regel is { text, user?, color?, indent?, numbered?, gap? }:
 * user = tip die tijdens de presentatie is toegevoegd; de rest zijn eigenschappen van een keyword.
 */
const itemKey = (it) => [it.user ? '+' : '-', it.color || '', it.indent || 0, it.numbered ? '#' : '', it.gap || '', it.text].join('|');

function createListItem(it) {
  const li = document.createElement('li');
  li.textContent = it.text;
  li.dataset.key = itemKey(it);
  if (it.user) li.classList.add('user');
  applyKeywordLook(li, it);
  return li;
}

/** Zet de eigenschappen van een keyword op een regel. */
function applyKeywordLook(li, it) {
  const set = (name, value) => { if (value) li.dataset[name] = value; else delete li.dataset[name]; };
  set('color', it.color);
  set('indent', it.indent ? String(it.indent) : '');
  set('numbered', it.numbered ? 'true' : '');
  set('gap', it.gap);
}

/**
 * Nummert de genummerde regels, per inspringniveau: opeenvolgende genummerde regels op
 * hetzelfde niveau tellen door; een regel zonder nummer op dat niveau, of een regel die minder
 * ver inspringt, laat de telling opnieuw beginnen. Dieper ingesprongen regels onderbreken niet.
 */
function renumber(ul) {
  const count = [0, 0, 0];
  for (const li of ul.children) {
    const level = Number(li.dataset.indent || 0);
    for (let l = level + 1; l < count.length; l++) count[l] = 0;
    if (li.dataset.numbered) li.dataset.num = ++count[level];
    else { count[level] = 0; delete li.dataset.num; }
  }
}

/**
 * Zet de lijst; als de nieuwe lijst de oude aanvult, worden alleen de nieuwe regels toegevoegd.
 * Meerdere nieuwe regels (een klik met meer items) worden kort na elkaar "geschreven".
 */
function setList(ul, items, animateNew) {
  const current = [...ul.children].map((li) => li.dataset.key);
  const extendsCurrent = current.length <= items.length && current.every((k, i) => k === itemKey(items[i]));
  if (!extendsCurrent) ul.replaceChildren();
  for (let i = ul.children.length, n = 0; i < items.length; i++, n++) {
    const li = createListItem(items[i]);
    ul.append(li);
    if (animateNew) {
      animate(li, [
        { clipPath: 'inset(-10% 100% -10% 0)', opacity: 0.4 },
        { clipPath: 'inset(-10% 0 -10% 0)', opacity: 1 },
      ], { duration: 550, delay: n * 150, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'backwards' });
    }
  }
  renumber(ul);
}

/** Verkleint de letters als de inhoud niet meer op het vel past. */
function fitList(sheet, ul, maxPx, minPx) {
  let size = maxPx;
  ul.style.setProperty('--list-font', size + 'px');
  while (sheet.scrollHeight > sheet.clientHeight && size > minPx) {
    size -= 2;
    ul.style.setProperty('--list-font', size + 'px');
  }
  if (sheet.scrollHeight > sheet.clientHeight && !sheet.classList.contains('turning') && !sheet.closest('#print')) {
    console.warn(`Te veel tekst voor de flip-over (${ul.children.length} regels): de onderste vallen van het vel. Kort de teksten in of verdeel ze over meer vellen.`);
  }
}

/** Toont of verbergt de vraag in de vraagzone onderaan het bord. Bij null verdwijnt hij. */
function showQuestion(text, animated) {
  const box = els.question;
  if (text === null) {
    if (box.hidden) return;
    if (!animated) { box.hidden = true; return; }
    animate(box, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-in' }, () => { box.hidden = true; });
    return;
  }

  els.questionText.textContent = text;
  box.hidden = false;
  fitQuestion();

  if (!animated) return;
  animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  animate(box.querySelector('.q-mark'), [
    { transform: 'rotate(-6deg) scale(0.3)', opacity: 0 },
    { transform: 'rotate(-6deg) scale(1.15)', opacity: 1, offset: 0.6 },
    { transform: 'rotate(-6deg) scale(1)' },
  ], { duration: 450, easing: 'cubic-bezier(.3,.6,.3,1)' });
  animate(els.questionText, [
    { clipPath: 'inset(-10% 100% -10% 0)' },
    { clipPath: 'inset(-10% 0 -10% 0)' },
  ], { duration: 800, delay: 150, easing: 'cubic-bezier(.3,.6,.3,1)', fill: 'backwards' });
}

/** Verkleint de letters van de vraag tot hij past. */
function fitQuestion() {
  const box = els.question;
  let size = 40;
  box.style.setProperty('--q-font', size + 'px');
  while (box.scrollHeight > box.clientHeight && size > 18) {
    size -= 2;
    box.style.setProperty('--q-font', size + 'px');
  }
}

/** Vel omslaan. Vooruit: het oude vel gaat omhoog. Terug: het vorige vel komt naar beneden. */
function turnSheet(forward) {
  const sheet = els.keywordSheet;
  const ghost = sheet.cloneNode(true);
  ghost.inert = true; // alleen beeld: niet met Tab of een schermlezer te bereiken
  ghost.removeAttribute('id');
  for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
  ghost.classList.add('turning');

  if (forward) {
    // De kopie toont het oude vel en slaat om; het echte vel krijgt meteen de nieuwe inhoud.
    els.keywordPad.append(ghost);
    animate(ghost, [
      { transform: 'rotateX(0deg)', opacity: 1 },
      { transform: 'rotateX(-95deg)', opacity: 1, offset: 0.55 },
      { transform: 'rotateX(-170deg)', opacity: 0 },
    ], { duration: 800, easing: 'cubic-bezier(.4,.1,.4,1)' }, () => ghost.remove());
  } else {
    // De kopie wordt gevuld met het vorige vel en klapt naar beneden over het huidige heen.
    const ul = ghost.querySelector('ul');
    ghost.querySelector('.sheet-title').textContent = titleAt(pos);
    ul.replaceChildren(...keywordsAt(pos).map(createListItem));
    renumber(ul);
    els.keywordPad.append(ghost);
    fitList(ghost, ul, LIST_FONT_MAX, 20);
    // Tijdens het omklappen het echte vel leeg tonen, anders is de inhoud dubbel te zien.
    const hidden = [sheet.querySelector('ul'), sheet.querySelector('.sheet-title')];
    for (const el of hidden) el.style.visibility = 'hidden';
    animate(ghost, [
      { transform: 'rotateX(-170deg)', opacity: 0 },
      { transform: 'rotateX(-95deg)', opacity: 1, offset: 0.45 },
      { transform: 'rotateX(0deg)', opacity: 1 },
    ], { duration: 800, easing: 'cubic-bezier(.4,.1,.4,1)' }, () => {
      ghost.remove();
      for (const el of hidden) el.style.visibility = '';
    });
  }
}

/* ---------- Geeltjes met FLIP-animatie ---------- */

function columnOf(el) {
  for (const [name, col] of Object.entries(els.cols)) if (el.parentElement === col) return name;
  return null;
}

function placeInColumn(el, colName) {
  const col = els.cols[colName];
  const t = Number(el.dataset.topic);
  const before = [...col.children].find((c) => Number(c.dataset.topic) > t);
  // In Doing staan (bewerkmodus) ook de pijlen: het geeltje ertussen, zodat de tabvolgorde ◀, geeltje, ▶ is.
  col.insertBefore(el, before || col.querySelector('.move-later') || null);
}

// Tijdlijn van een overgang naar een nieuw onderwerp (ongeveer 2 s):
//   0 ms     het vel slaat om (800 ms), met geritsel (550 ms)
//   620 ms   het oude geeltje wordt opgepakt (geluid) en gaat rustig naar Done (650 ms)
//            en wordt daar vastgedrukt (geluid)
//   + 170 ms korte pauze, dan hetzelfde voor het nieuwe geeltje van To do naar Doing
const STICKY_AFTER_TURN = 620; // ms: als het vel grotendeels om is en het geritsel voorbij
const STICKY_MOVE = 650;       // ms per geeltje: rustig, niet gehaast
const STICKY_PAUSE = 170;      // ms tussen het wegzetten van het oude en oppakken van het nieuwe (na het plakgeluid)
const STICKY_SOUNDS_MAX = 3;   // geluidjes per fase (bij sprongen met veel geeltjes)

/** Wacht ms milliseconden; false als er intussen verder is genavigeerd. */
const waitFor = (ms, my) => new Promise((resolve) => setTimeout(() => resolve(my === generation), ms));

/**
 * Zet de geeltjes in de juiste kolom, geanimeerd in twee fasen: eerst wat uit Doing vertrekt,
 * dan de rest (bijv. To do → Doing). Zonder animatie (begin, bewerken, afsluitscherm)
 * verspringen ze meteen en stil.
 */
async function moveStickies(current, animated, my, delay = 0) {
  const target = (el) => columnFor(Number(el.dataset.topic), current);
  const needsMove = stickies.filter((el) => columnOf(el) !== target(el));
  if (needsMove.length === 0) return;

  if (!animated) {
    for (const el of needsMove) placeInColumn(el, target(el));
    return;
  }
  if (delay && !(await waitFor(delay, my))) return;

  const phases = [
    needsMove.filter((el) => columnOf(el) === 'doing'),
    needsMove.filter((el) => columnOf(el) !== 'doing'),
  ].filter((phase) => phase.length);
  for (const [n, phase] of phases.entries()) {
    if (n > 0 && !(await waitFor(STICKY_PAUSE, my))) return;
    await flipMove(phase, target, my);
    if (my !== generation) return;
  }
}

function flipMove(movers, target, my) {
  const first = new Map(stickies.map((el) => [el, el.getBoundingClientRect()]));
  for (const el of movers) placeInColumn(el, target(el));

  const promises = [];
  let order = 0;
  for (const el of stickies) {
    const f = first.get(el);
    const l = el.getBoundingClientRect();
    const dx = (f.left - l.left) / scale;
    const dy = (f.top - l.top) / scale;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;

    const isMover = movers.includes(el);
    const index = isMover ? order++ : -1;
    // De andere geeltjes schuiven pas op als het opgepakte geeltje is opgetild: niet alles tegelijk.
    const delay = isMover ? Math.min(index * 90, 600) : STICKY_MOVE * 0.35;
    const withSound = isMover && index < STICKY_SOUNDS_MAX;
    // Opgepakt (groter, hoger, met een grote schaduw), dan teruggezet en even aangedrukt.
    const frames = isMover
      ? [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 18}px) scale(1.14)`, offset: 0.5 },
          { transform: 'scale(0.97)', offset: 0.9 },
          { transform: 'none' },
        ]
      : [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }];

    if (isMover) {
      // Pas bij het opstijgen de schaduw en het oppakgeluid, niet al tijdens het wachten.
      setTimeout(() => {
        if (my !== generation) return;
        el.classList.add('moving');
        if (withSound) playPickup();
      }, delay);
    }
    promises.push(new Promise((resolve) => {
      animate(el, frames, {
        duration: isMover ? STICKY_MOVE : 400,
        delay,
        easing: 'cubic-bezier(.45,.05,.3,1)',
        fill: 'backwards',
      }, () => {
        el.classList.remove('moving');
        // Vastplakken klinkt alleen als de beweging echt af is, niet bij afbreken door doorklikken.
        if (withSound && my === generation) playStick();
        resolve();
      });
    }));
  }
  return Promise.all(promises);
}

/* ---------- Zelf een tip toevoegen ---------- */
// Plusje op de Tips-flip-over (of T) → één regel invoer. Enter (of wegklikken) voegt toe, Esc
// annuleert. Alleen live: in de bewerkmodus gaan tips via het tekstvak van het vel.

function openTipForm() {
  els.tipForm.hidden = false;
  els.tipInput.value = '';
  els.tipInput.focus({ preventScroll: true });
  fitList(els.tipsSheet, els.tipsList, LIST_FONT_MAX, 18);
}

function closeTipForm() {
  els.tipForm.hidden = true; // vóór blur(), zodat de blur-handler niet nog eens indient
  els.tipInput.blur();
  fitList(els.tipsSheet, els.tipsList, LIST_FONT_MAX, 18);
}

/**
 * Een tijdens de presentatie toegevoegde tip wordt een gewoon item (met user: true) in de
 * huidige step: na opnieuw laden verschijnt hij dus bij dezelfde klik. Is er op dit vel nog
 * niets geklikt, dan wordt het een nieuwe eerste step.
 */
function submitTip() {
  const text = els.tipInput.value.trim();
  closeTipForm();
  if (!text || !isContent(pos)) return;
  const item = { type: 'tip', text, user: true };
  const steps = flat[pos.sheet].steps;
  if (pos.step === 0) { steps.unshift([item]); pos = { sheet: pos.sheet, step: 1 }; }
  else steps[pos.step - 1].push(item);
  finishAllAnimations();
  playBell();
  announce(['Tip toegevoegd: ' + text]);
  renderTips(true);
  updateHash();
  updateButtons();
}

// mousedown niet laten doorgaan: dan houdt de invoer de focus en verwerkt click het verder.
els.addTip.addEventListener('mousedown', (e) => e.preventDefault());
els.addTip.addEventListener('click', () => {
  if (els.tipForm.hidden) openTipForm();
  else submitTip();
});
els.tipForm.addEventListener('submit', (e) => { e.preventDefault(); submitTip(); });
els.tipInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); closeTipForm(); }
});
els.tipInput.addEventListener('blur', () => { if (!els.tipForm.hidden) submitTip(); });

/* ---------- Aanwijzen (live) ---------- */
// Klik op een steekwoord op de rechter flip-over: van links komt een gesloten blauwe stift in
// beeld (de standaardkleur van steekwoorden), met de dop bij de stip van die regel, en tikt één
// keer (doffe tik). Nog eens klikken op hetzelfde steekwoord of Esc haalt hem weg (zonder
// geluid); een ander steekwoord aanklikken verplaatst hem. Elke andere verandering (een klik,
// een ander vel, een ander formaat van het venster) haalt hem meteen weg. Voor schermlezers staat
// vóór het aangewezen steekwoord "(x)", net als bij een afgevinkt doel; het aanwijzen zelf wordt
// niet voorgelezen. Niet in de bewerkmodus: daar opent een klik op het vel het tekstvak.

let pointed = null; // { li, el } zolang er iets wordt aangewezen

function pointAt(li) {
  if (pointed?.li === li) return hidePointer(true);
  hidePointer(false);
  const r = li.getBoundingClientRect();
  const stage = els.stage.getBoundingClientRect();
  const style = getComputedStyle(li);
  // De dop komt net links van de stip of het nummer, op het midden van de eerste regel.
  const firstLine = parseFloat(style.paddingTop) + parseFloat(style.lineHeight) / 2; // lineHeight in px
  const x = (r.left - stage.left) / scale - 6;
  const y = (r.top - stage.top) / scale + (Number.isFinite(firstLine) ? firstLine : r.height / scale / 2);
  const el = document.createElement('div');
  el.className = 'pointer';
  el.setAttribute('aria-hidden', 'true');
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.innerHTML = '<i class="marker pointer-marker"></i>';
  els.stage.append(el);
  const state = document.createElement('span');
  state.className = 'sr-only pointer-state';
  state.textContent = '(x) ';
  li.prepend(state);
  pointed = { li, el };
  animate(el, [
    { transform: 'translate(-90px, 6px) rotate(-14deg)', opacity: 0 },
    { transform: 'translate(3px, 0) rotate(-8deg)', opacity: 1, offset: 0.75 },   // tik tegen het papier
    { transform: 'translate(0, 0) rotate(-8deg)', opacity: 1 },
  ], { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)' });
  setTimeout(() => { if (pointed?.el === el) playTap(); }, 280); // op het moment van de tik
}

/** Haalt de aanwijzer weg; met animated glijdt hij snel terug (zonder geluid). */
function hidePointer(animated) {
  if (!pointed) return;
  const { li, el } = pointed;
  pointed = null;
  li.querySelector('.pointer-state')?.remove();
  if (!animated) return el.remove();
  animate(el, [
    { transform: 'translate(0, 0) rotate(-8deg)', opacity: 1 },
    { transform: 'translate(-70px, 4px) rotate(-12deg)', opacity: 0 },
  ], { duration: 170, easing: 'ease-in' }, () => el.remove());
}

if (!editMode) {
  els.keywordList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    if (li && isContent(pos)) pointAt(li);
  });
}

/* ---------- Bewerken (?edit) ---------- */
// De bewerkmodus heeft geen eigen sneltoetsen: alles wat je kunt bewerken is een echte knop (met
// Tab bereikbaar; Enter en spatie doen daarop wat de browser bij een knop doet, net als een klik).
// Klik op de rechter flip-over of de knop "Vel bewerken": alle klikken van het vel verschijnen als
// tekst in één tekstvak ter grootte van het vel (notatie: zie sheet-text.js). Opslaan (of
// Ctrl+Enter) verwerkt alles in één keer, daarna is het hele vel in beeld; Annuleren (of Esc) laat
// het vel zoals het was. De titel van het vel bewerk je los: een klik erop maakt er een invoerveld
// van. Tips bewerk je via het tekstvak; een klik op een tip links zegt op welk vel hij staat. De
// werkafspraken bewerk je op dezelfde manier, als ze in beeld zijn (klik erop, of de knop
// "Werkafspraken bewerken"); één afspraak per regel. Alles gaat in het model; de export op het
// afsluitscherm neemt het over.

// textEditor (bovenaan gedeclareerd): { box, input, opener, onSave } zolang een tekstvak open is

const code = (t) => `<code>${t}</code>`;

/**
 * Opent een tekstvak met uitleg en de knoppen Annuleren en Opslaan over host heen. Er is altijd
 * hooguit één tekstvak open; zolang dat zo is, kun je niet bladeren.
 * label: naam van de groep; textLabel: naam van het tekstvak; help: regels uitleg (HTML).
 */
function openTextEditor({ host, className = '', label, textLabel, text, help, validate, onSave }) {
  if (!editMode || textEditor || !isContent(pos)) return;
  finishAllAnimations();
  const box = document.createElement('div');
  box.className = ('sheet-editor ' + className).trim();
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', label);
  box.innerHTML = `
    <textarea class="sheet-editor-text" aria-describedby="text-editor-help"></textarea>
    <p class="sheet-editor-help" id="text-editor-help"></p>
    <div class="sheet-editor-buttons">
      <button type="button" data-action="cancel" aria-keyshortcuts="Escape" title="Wijzigingen weggooien (Esc)">Annuleren</button>
      <button type="button" data-action="save" class="primary" aria-keyshortcuts="Control+Enter Meta+Enter" title="Opslaan (Ctrl+Enter)">Opslaan</button>
    </div>`;
  box.querySelector('.sheet-editor-help').innerHTML = help.join('<br>');
  const input = box.querySelector('textarea');
  input.setAttribute('aria-label', textLabel);
  input.value = text;
  textEditor = { box, input, opener: document.activeElement, validate, onSave };

  box.addEventListener('click', (e) => {
    e.stopPropagation(); // niet doorgeven aan wat eronder ligt (dat zou het tekstvak meteen weer openen)
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action) closeTextEditor(action === 'save');
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeTextEditor(false);
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) closeTextEditor(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  host.append(box);
  updateButtons();
  input.focus({ preventScroll: true });
  input.setSelectionRange(0, 0);
  input.scrollTop = 0;
}

function closeTextEditor(save) {
  if (!textEditor) return;
  const { box, input, opener, validate, onSave } = textEditor;
  // Klopt er iets niet (validate geeft een zin), dan blijft het tekstvak open, met een melding.
  const problem = save && validate ? validate(input.value) : null;
  if (problem) {
    showNotice(problem);
    input.focus({ preventScroll: true });
    return;
  }
  textEditor = null;
  box.remove();
  if (save) onSave(input.value);
  updateButtons();
  if (opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
}

function openSheetEditor() {
  if (!isContent(pos)) return;
  const f = flat[pos.sheet];
  openTextEditor({
    host: els.keywordPad,
    label: 'Vel bewerken: ' + f.title,
    textLabel: 'Klikken van het vel als tekst',
    text: stepsToText(f.steps),
    // Zo kort mogelijk, en algemeen: niets uit de inhoud van deze presentatie.
    help: [
      `${code('*')} ${code('-')} ${code('1.')} steekwoord, 2/4 spaties inspringen`,
      `lege regel ruimte, ${code('---')} lijn, ${code('-&gt;')} klik`,
      `${code('?')} vraag, ${code('!')} tip, ${code('+' + GOAL_IDS[0])} t/m ${code('+' + GOAL_IDS.at(-1))} doel afvinken`,
      `${code('[kleur]')} ${[...KEYWORD_COLORS].join(' ')}`,
      `${code('@naam beschrijving')} afbeelding ophangen (formaat: ${code('[A3]')} ${code('[A4]')} ${code('[A5]')}), ${code('@-')} weghalen`,
    ],
    // Een afbeelding heeft een geldige naam en een beschrijving nodig: anders niet opslaan.
    validate: (text) => textToSteps(text, new Set()).flat().map((it) => pinProblem(it, IMAGE_NAME)).find(Boolean) ?? null,
    onSave: saveSheet,
  });
}

/** Alleen als de werkafspraken in beeld zijn. */
function openAgreementsEditor() {
  if (els.agreementsBox.hidden) return;
  openTextEditor({
    host: els.agreementsBox,
    className: 'agreements-editor',
    label: 'Werkafspraken bewerken',
    textLabel: 'Werkafspraken, één per regel',
    text: listToText(deck.agreements),
    help: [`Eén werkafspraak per regel. ${code('-')} ${code('*')} ${code('•')} of ${code('1.')} aan het begin en lege regels vallen weg.`],
    onSave: saveAgreements,
  });
}

function saveAgreements(text) {
  const list = textToList(text);
  if (JSON.stringify(list) === JSON.stringify(deck.agreements)) return;
  deck.agreements = list;
  renderAgreements();
}

/** Sleutel om items te vergelijken, ongeacht de volgorde van de velden. */
const itemSignature = (item) => JSON.stringify(Object.keys(item).sort().map((k) => [k, item[k]]));

/**
 * Verwerkt de tekst in het huidige vel. Items die precies gelijk bleven, houden hun object; dan
 * telt het afsluitscherm ze niet als verwijderd en opnieuw toegevoegd. Tips worden altijd
 * gewone tips (zonder "user"): in de bewerkmodus presenteren we niet. Daarna het hele vel in beeld.
 */
function saveSheet(text) {
  const i = pos.sheet;
  const f = flat[i];
  const pool = new Map();
  for (const item of f.steps.flat()) {
    const key = itemSignature(item);
    pool.set(key, [...(pool.get(key) ?? []), item]);
  }
  const steps = textToSteps(text, new Set(deck.goals.map((g) => g.id)))
    .map((step) => step.map((item) => pool.get(itemSignature(item))?.shift() ?? item));
  // Een doel vink je maar één keer af: een doel dat al op een ander vel (of eerder op dit vel)
  // wordt afgevinkt, valt hier weg, met een melding. Dezelfde regel als bij het inlezen van de JSON.
  const seen = new Map();
  dropRepeatedChecks(flat.filter((o) => o !== f).map((o) => ({ title: o.title, steps: o.steps.map((step) => [...step]) })), seen);
  const dropped = dropRepeatedChecks([{ title: f.title, steps }], seen);
  f.steps.splice(0, f.steps.length, ...steps); // dezelfde lijst als in deck
  for (const item of steps.flat()) if (item.type === 'pin') loadImage(item.image);
  pos = { sheet: i, step: f.steps.length };
  render(null);
  if (dropped.length) {
    const once = [...new Map(dropped.map((d) => [d.goal, d])).values()]; // elk doel één keer noemen
    showNotice(once.map((d) => `${d.goal} wordt al afgevinkt op „${d.first}”`).join('; ') + '. Een doel vink je maar één keer af, dus hier niet nog eens.');
  }
}

/**
 * Maakt van een titel op zijn plek een invoerveld (de titel van een vel, of die van de
 * presentatie op het startscherm). Enter of wegklikken slaat op, Esc annuleert; een titel is
 * verplicht, dus leeg opslaan geldt als annuleren. onSave(waarde) volgt alleen bij een andere,
 * niet-lege waarde; daarna onDone. Bij annuleren onCancel (als die er is), anders blijft alles zo.
 */
function editInPlace(el, { label, className, maxLength, onSave, onDone, onCancel }) {
  const original = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  if (maxLength) input.maxLength = maxLength; // een langere bestaande tekst blijft staan; alleen typen stopt
  input.className = className + ' in-place'; // in-place: zie de waarschuwing bij sluiten
  input.value = original;
  input.setAttribute('aria-label', label);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.replace(/\s+/g, ' ').trim();
    const refocus = document.activeElement === input;
    input.remove();
    el.hidden = false;
    const kept = save && value !== '';
    if (!kept && onCancel) return onCancel();
    if (kept && value !== original) onSave(value);
    if (refocus) (el.matches('button') ? el : el.querySelector('button') ?? el).focus({ preventScroll: true });
    if (kept) onDone?.();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation()); // niet ook wat eronder ligt openen
  el.hidden = true;
  el.after(input);
  input.focus({ preventScroll: true });
  input.select();
}

/**
 * De titel van het huidige vel bewerken, op zijn plek (zie editInPlace). Bij een nieuw vel
 * (addSheet) volgt daarna onDone, of bij annuleren (Esc of leeg) onCancel.
 */
function editTitle({ onDone, onCancel } = {}) {
  if (!editMode || textEditor || !isContent(pos) || els.keywordTitle.hidden) return;
  finishAllAnimations();
  const f = flat[pos.sheet];
  editInPlace(els.keywordTitle, {
    label: 'Titel van het vel',
    className: 'title-edit',
    maxLength: SHEET_TITLE_MAX,
    onDone,
    onCancel,
    onSave: (value) => {
      f.title = value;
      deck.topics[f.topic].sheets[f.sheet].title = value;
      setEditableText(els.keywordTitle, titleAt(pos));
      fitList(els.keywordSheet, els.keywordList, LIST_FONT_MAX, 20); // de titel kan langer of korter zijn
    },
  });
}

/** De titel van de presentatie bewerken, op het startscherm onder "WELKOM" (zie editInPlace). */
function editPresentationTitle() {
  if (!editMode || !isStart(pos) || els.startSubtitle.hidden) return;
  editInPlace(els.startSubtitle, {
    label: 'Titel van de presentatie',
    className: 'presentation-title-edit',
    onSave: (value) => {
      deck.title = value;
      document.title = value;
      setEditableText(els.startSubtitle, value);
    },
  });
}

/* ---------- Vellen toevoegen en verwijderen (?edit) ---------- */
// "Vel toevoegen": een nieuw, leeg vel "Nieuw vel" direct na het huidige, bij hetzelfde
// onderwerp. De titel staat meteen open: Enter of wegklikken houdt het vel en opent daarna het
// tekstvak van het vel; Esc of een lege titel maakt het toevoegen ongedaan. "Vel verwijderen": het
// huidige vel weg, na een bevestiging als er iets op staat. Is het het enige vel van zijn
// onderwerp, dan verdwijnt het onderwerp mee (altijd na bevestiging); het enige vel van de hele
// presentatie kan niet weg (de knop is dan uitgeschakeld). Daarna wordt alles opnieuw getekend.

const NEW_SHEET_TITLE = 'Nieuw vel';

function addSheet() {
  if (!editMode || textEditor || !isContent(pos) || els.keywordTitle.hidden) return;
  const back = pos;
  const f = flat[pos.sheet];
  const sheets = deck.topics[f.topic].sheets;
  const sheet = { title: NEW_SHEET_TITLE, steps: [] };
  sheets.splice(f.sheet + 1, 0, sheet);
  rebuildFlat();
  pos = { sheet: back.sheet + 1, step: 0 };
  render(null);
  editTitle({
    onDone: () => openSheetEditor(),
    onCancel: () => {
      sheets.splice(sheets.indexOf(sheet), 1);
      rebuildFlat();
      pos = back;
      render(null);
      els.addSheetBtn.focus({ preventScroll: true });
    },
  });
}

function deleteSheet() {
  if (!editMode || textEditor || !isContent(pos)) return;
  const f = flat[pos.sheet];
  const sheets = deck.topics[f.topic].sheets;
  const what = f.steps.length ? `Op dit vel staan ${describeContent(f.steps)}. Die verdwijnen mee.` : '';
  if (sheets.length === 1) {
    // Het enige vel van het onderwerp: dan verdwijnt het onderwerp ook (altijd bevestigen).
    if (deck.topics.length === 1) return; // het enige vel van de presentatie (de knop is dan uit)
    const sticky = deck.topics[f.topic].sticky;
    if (!confirm(`Vel „${f.title}” verwijderen?\n\nDit is het enige vel van onderwerp „${sticky}”, dus dat onderwerp verdwijnt ook. ${what}`.trim())) return;
    return removeTopicAt(f.topic);
  }
  if (f.steps.length && !confirm(`Vel „${f.title}” verwijderen?\n\n${what}`)) return;
  const first = f.sheet === 0; // dan naar het volgende vel van dit onderwerp, anders het vorige
  sheets.splice(f.sheet, 1);
  rebuildFlat();
  const target = first ? pos.sheet : pos.sheet - 1;
  pos = { sheet: target, step: first ? 0 : flat[target].steps.length };
  render(null);
}

/* ---------- Onderwerpen (geeltjes) bewerken (?edit) ---------- */
// Alleen het huidige onderwerp, het geeltje in Doing: klik erop (of Tab en Enter) om de naam te
// wijzigen. Onder dat geeltje: "+ Onderwerp" voegt na het huidige onderwerp een onderwerp
// toe met één leeg vel; de naam "Nieuw onderwerp" staat dan meteen open (Esc of leeg maakt het
// toevoegen ongedaan) en daarna opent het tekstvak van het nieuwe vel. "Onderwerp verwijderen"
// verwijdert het huidige onderwerp, na een bevestiging als er iets op staat; er blijft altijd
// minstens één onderwerp. Daarna worden de lijst met vellen en de geeltjes opnieuw opgebouwd.

const NEW_TOPIC_NAME = 'Nieuw onderwerp';

/** De naam van het huidige onderwerp bewerken, op het geeltje in Doing (zie editInPlace). */
function editTopicName({ onDone, onCancel } = {}) {
  if (!editMode || textEditor || !isContent(pos)) return;
  const t = flat[pos.sheet].topic;
  const sticky = stickies[t];
  if (sticky.hidden) return;
  finishAllAnimations();
  editInPlace(sticky, {
    label: 'Naam van het onderwerp',
    className: 'sticky-edit',
    maxLength: TOPIC_NAME_MAX,
    onDone,
    onCancel,
    onSave: (value) => {
      deck.topics[t].sticky = value;
      sticky.querySelector('.note').textContent = value;
      fitStickyText(stickyFontPx);
      updateButtons();
    },
  });
}

function addTopic() {
  if (!editMode || textEditor || !isContent(pos)) return;
  if (deck.topics.length >= TOPICS_MAX) return; // de knop is dan uit
  const back = pos;
  const t = flat[pos.sheet].topic;
  const topic = { sticky: NEW_TOPIC_NAME, sheets: [{ title: NEW_SHEET_TITLE, steps: [] }] };
  deck.topics.splice(t + 1, 0, topic);
  topicsUpdated();
  pos = { sheet: firstSheetOfTopic[t + 1], step: 0 };
  render(null);
  editTopicName({
    onDone: () => openSheetEditor(),
    onCancel: () => {
      deck.topics.splice(deck.topics.indexOf(topic), 1);
      topicsUpdated();
      pos = back;
      render(null);
      els.addTopicBtn.focus({ preventScroll: true });
    },
  });
}

function deleteTopic() {
  if (!editMode || textEditor || !isContent(pos)) return;
  if (deck.topics.length === 1) return; // er blijft altijd minstens één onderwerp (de knop is dan uit)
  const t = flat[pos.sheet].topic;
  const topic = deck.topics[t];
  const steps = topic.sheets.flatMap((sheet) => sheet.steps);
  if (steps.length && !confirm(`Onderwerp „${topic.sticky}” verwijderen?\n\nHierin staan ${describeContent(steps, topic.sheets.length)}. Die verdwijnen mee.`)) return;
  removeTopicAt(t);
}

/**
 * Haalt onderwerp t weg. Daarna sta je op het laatste vel van het vorige onderwerp (helemaal
 * ingevuld), of bij het eerste onderwerp op het begin van het volgende; dat onderwerp komt in Doing.
 */
function removeTopicAt(t) {
  deck.topics.splice(t, 1);
  topicsUpdated();
  if (t === 0) pos = { sheet: 0, step: 0 };
  else {
    const last = (t < deck.topics.length ? firstSheetOfTopic[t] : flat.length) - 1;
    pos = { sheet: last, step: flat[last].steps.length };
  }
  render(null);
}

/** Na toevoegen of verwijderen van een onderwerp: de vellen en de geeltjes opnieuw opbouwen. */
function topicsUpdated() {
  rebuildFlat();
  buildStickies(); // nieuwe geeltjes in To do; render() zet ze op hun plek
  fitStickyText(stickyFontPx);
}

/**
 * Wat er op een vel of onderwerp staat, voor een bevestigingsvraag: "2 klikken, met 1 tip" of
 * (met sheetCount) "3 vellen, 18 klikken, met 3 tips, 1 afbeelding en het afvinken van doel1".
 */
function describeContent(steps, sheetCount = 0) {
  const count = (n, one, more) => `${n} ${n === 1 ? one : more}`;
  const items = steps.flat();
  const tips = items.filter((it) => it.type === 'tip').length;
  const goals = [...new Set(items.filter((it) => it.type === 'check').map((it) => it.goal))];
  const pins = items.filter((it) => it.type === 'pin').length;
  const extra = [tips ? count(tips, 'tip', 'tips') : '', pins ? count(pins, 'afbeelding', 'afbeeldingen') : '',
    goals.length ? 'het afvinken van ' + goals.join(' en ') : ''].filter(Boolean);
  const head = (sheetCount ? count(sheetCount, 'vel', 'vellen') + ', ' : '') + count(steps.length, 'klik', 'klikken');
  const list = extra.length > 1 ? extra.slice(0, -1).join(', ') + ' en ' + extra.at(-1) : extra[0];
  return head + (list ? ', met ' + list : '');
}

/* ---------- Verplaatsen (?edit) ---------- */
// Pijlen naast het geeltje in Doing verplaatsen het huidige onderwerp een plek eerder of later
// (met al zijn vellen); de andere geeltjes schuiven mee tussen Done en To do. Pijlen bij de titel
// van het vel verplaatsen het huidige vel binnen zijn onderwerp, en aan het begin of eind (na een
// bevestiging) naar het vorige onderwerp (als laatste vel) of het volgende (als eerste). Alles
// op het vel gaat mee. Je blijft op hetzelfde vel en dezelfde klik.

function moveTopic(delta) {
  if (!editMode || textEditor || !isContent(pos)) return;
  const t = flat[pos.sheet].topic;
  const to = t + delta;
  if (to < 0 || to >= deck.topics.length) return;
  const sheet = flat[pos.sheet].model;
  const step = pos.step;
  deck.topics.splice(to, 0, ...deck.topics.splice(t, 1));
  topicsUpdated();
  pos = { sheet: flat.findIndex((f) => f.model === sheet), step };
  render(null);
  showNotice(`Onderwerp staat nu op plek ${to + 1} van ${deck.topics.length}.`);
}

function moveSheet(delta) {
  if (!editMode || textEditor || !isContent(pos)) return;
  const f = flat[pos.sheet];
  const source = deck.topics[f.topic];
  const sheets = source.sheets;
  const step = pos.step;
  const to = f.sheet + delta;
  if (to >= 0 && to < sheets.length) {
    sheets.splice(to, 0, ...sheets.splice(f.sheet, 1));
  } else {
    // Naar het vorige of volgende onderwerp. Was het het enige vel, dan verdwijnt dat onderwerp.
    const target = deck.topics[f.topic + delta];
    if (!target) return;
    const earlier = delta < 0;
    const emptied = sheets.length === 1 ? ` Dit is het enige vel van onderwerp „${source.sticky}”, dus dat onderwerp verdwijnt.` : '';
    if (!confirm(`Vel „${f.title}” naar het ${earlier ? 'vorige' : 'volgende'} onderwerp „${target.sticky}” verplaatsen?\n\nHet komt daar als ${earlier ? 'laatste' : 'eerste'} vel.${emptied}`)) return;
    sheets.splice(f.sheet, 1);
    if (earlier) target.sheets.push(f.model); else target.sheets.unshift(f.model);
    if (emptied) {
      deck.topics.splice(deck.topics.indexOf(source), 1);
      buildStickies();
      fitStickyText(stickyFontPx);
    }
  }
  rebuildFlat();
  pos = { sheet: flat.findIndex((g) => g.model === f.model), step };
  render(null);
  const g = flat[pos.sheet];
  const where = deck.topics[g.topic] === source ? '' : ` bij „${deck.topics[g.topic].sticky}”`;
  showNotice(`Vel staat nu op plek ${g.sheet + 1} van ${deck.topics[g.topic].sheets.length}${where}.`);
}

/** Pijlen aan of uit, met in de tooltip waarom niet. */
function updateMoveButtons(editing) {
  const content = isContent(pos) && !editing;
  const f = content ? flat[pos.sheet] : null;
  const set = (button, enabled, title) => { button.disabled = !enabled; button.title = title; };
  const lastTopic = deck.topics.length - 1;
  set(els.topicEarlier, content && f.topic > 0, f && f.topic === 0 ? 'Dit is het eerste onderwerp' : 'Onderwerp een plek eerder');
  set(els.topicLater, content && f.topic < lastTopic, f && f.topic === lastTopic ? 'Dit is het laatste onderwerp' : 'Onderwerp een plek later');
  const count = f ? deck.topics[f.topic].sheets.length : 0;
  const gone = count === 1 ? '; dit onderwerp verdwijnt dan' : '';
  const earlier = !f ? '' : f.sheet > 0 ? 'Vel een plek eerder'
    : f.topic === 0 ? 'Dit is het eerste vel' : `Vel naar het vorige onderwerp (als laatste)${gone}`;
  const later = !f ? '' : f.sheet < count - 1 ? 'Vel een plek later'
    : f.topic === lastTopic ? 'Dit is het laatste vel' : `Vel naar het volgende onderwerp (als eerste)${gone}`;
  set(els.sheetEarlier, content && (f.sheet > 0 || f.topic > 0), earlier);
  set(els.sheetLater, content && (f.sheet < count - 1 || f.topic < lastTopic), later);
}

/* ---------- Doelen bewerken (?edit) ---------- */
// Klik op de tekst van een doel (een knop): die wordt een invoerveld. Enter of wegklikken slaat
// op, Esc annuleert. Leeg opslaan verwijdert het doel; wordt het ergens
// afgevinkt, dan eerst een bevestiging, en die afvinkmomenten verdwijnen mee. De doelen erna
// schuiven een vak op (doel4 wordt doel3, ook in de vellen). Toevoegen kan alleen op het
// eerstvolgende lege vak: de knop "+ Doel toevoegen".

function editGoal(li) {
  if (!editMode || textEditor || !isContent(pos) || els.goals.querySelector('.goal-edit')) return;
  finishAllAnimations();
  const goal = deck.goals.find((g) => g.id === li.dataset.goal) ?? null; // null: nieuw doel
  const id = goal ? goal.id : li.dataset.slot;
  const target = li.querySelector(goal ? '.goal-text' : '.goal-add-btn');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'goal-edit in-place';
  input.maxLength = GOAL_TEXT_MAX;
  input.value = goal ? goal.text : '';
  input.setAttribute('aria-label', goal ? 'Tekst van het doel' : 'Nieuw doel');
  input.setAttribute('aria-describedby', 'goal-code-' + id);
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value.replace(/\s+/g, ' ').trim();
    const refocus = document.activeElement === input;
    input.remove();
    target.hidden = false;
    li.classList.remove('editing');
    let focusId = id;
    if (save && goal && !value) {
      if (deleteGoal(goal)) focusId = GOAL_IDS[Math.min(deck.goals.length, GOAL_IDS.indexOf(id))];
    } else if (save && goal && value !== goal.text) {
      goal.text = value;
      goalsUpdated();
    } else if (save && !goal && value) {
      deck.goals.push({ id: GOAL_IDS[deck.goals.length], text: value });
      goalsUpdated();
    }
    if (refocus) focusGoal(focusId);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  input.addEventListener('blur', () => finish(true));
  li.classList.add('editing');
  target.hidden = true;
  target.after(input);
  input.focus({ preventScroll: true });
  input.select();
}

/** Toevoegen op het eerstvolgende lege vak (de knop "+ Doel toevoegen"; die is er alleen bij een leeg vak). */
function addGoal() {
  if (!editMode || textEditor || !isContent(pos)) return;
  const slot = els.goals.querySelector('.goal-add');
  if (slot) editGoal(slot);
}

/** Focus op de tekst van een doel, of op de knop "+ Doel toevoegen" als dat vak leeg is. */
function focusGoal(id) {
  const el = els.goals.querySelector(`[data-goal="${id}"] .goal-text`) ?? els.goals.querySelector('.goal-add-btn');
  el?.focus({ preventScroll: true });
}

/**
 * Verwijdert een doel. Wordt het afgevinkt, dan eerst bevestigen; die afvinkmomenten verdwijnen
 * mee (en een klik die daardoor leeg is ook). De doelen erna schuiven een vak op, ook in de
 * vellen. Geeft false als het verwijderen is afgebroken.
 */
function deleteGoal(goal) {
  const usedOn = flat.filter((f) => f.steps.some((step) => step.some((it) => it.type === 'check' && it.goal === goal.id)));
  if (usedOn.length && !confirm(
    `Doel ${goal.id} wordt afgevinkt op ${usedOn.map((f) => `„${f.title}”`).join(', ')}.\n\n`
    + 'Toch verwijderen? Die afvinkmomenten verdwijnen dan ook.')) return false;
  const n = deck.goals.indexOf(goal);
  deck.goals.splice(n, 1);
  const renamed = new Map(deck.goals.slice(n).map((g, k) => [g.id, GOAL_IDS[n + k]]));
  deck.goals.forEach((g, k) => { g.id = GOAL_IDS[k]; });
  flat.forEach((f, i) => {
    for (let s = f.steps.length - 1; s >= 0; s--) {
      const step = f.steps[s];
      for (let k = step.length - 1; k >= 0; k--) {
        const it = step[k];
        if (it.type !== 'check') continue;
        if (it.goal === goal.id) step.splice(k, 1);
        else if (renamed.has(it.goal)) it.goal = renamed.get(it.goal);
      }
      if (step.length === 0) {
        f.steps.splice(s, 1);
        if (i === pos.sheet && s < pos.step) pos = { sheet: i, step: pos.step - 1 };
      }
    }
  });
  goalsUpdated();
  render(null); // de vinkjes (en een vel waaruit een klik verdween) opnieuw
  return true;
}

/** Na elke wijziging aan de doelen: de strook opnieuw opbouwen en alles opnieuw passen. */
function goalsUpdated() {
  buildGoals();
  refitText();
  updateButtons();
}

/** Korte melding boven de bedieningsbalk (ook voorgelezen); verdwijnt na een paar seconden. */
let noticeTimer;
function showNotice(text) {
  clearTimeout(noticeTimer);
  els.notice.textContent = '';
  setTimeout(() => { els.notice.textContent = text; }, 50); // ook dezelfde tekst opnieuw voorlezen
  noticeTimer = setTimeout(() => { els.notice.textContent = ''; }, 6000);
}

/** Het vel (index in flat) waarop dit item staat, of -1. */
const sheetOf = (item) => flat.findIndex((f) => f.steps.some((step) => step.includes(item)));

if (editMode) {
  document.documentElement.classList.add('edit-mode');
  $('#edit-badge').hidden = false;
  els.editBtn.hidden = false;
  els.editBtn.addEventListener('click', () => openSheetEditor());
  els.addSheetBtn.hidden = false;
  els.topicTools.hidden = false;
  for (const [button, act] of [[els.topicEarlier, () => moveTopic(-1)], [els.topicLater, () => moveTopic(1)],
    [els.sheetEarlier, () => moveSheet(-1)], [els.sheetLater, () => moveSheet(1)]]) {
    button.hidden = false;
    button.addEventListener('click', (e) => { e.stopPropagation(); act(); }); // niet ook het tekstvak van het vel openen
  }
  els.addTopicBtn.addEventListener('click', () => addTopic());
  els.deleteTopicBtn.addEventListener('click', () => deleteTopic());
  els.deleteSheetBtn.hidden = false;
  els.addSheetBtn.addEventListener('click', () => addSheet());
  els.deleteSheetBtn.addEventListener('click', () => deleteSheet());
  els.agreementsEditBtn.addEventListener('click', () => openAgreementsEditor());
  els.imagesBtn.hidden = false;
  els.imagesBtn.addEventListener('click', () => openImagesDialog());
  els.agreementsBox.addEventListener('click', () => openAgreementsEditor());
  els.keywordSheet.addEventListener('click', () => openSheetEditor());
  // De titels (van het vel en van de presentatie) staan in de bewerkmodus in een knop (zie
  // setEditableText): klikken, of Tab en Enter of spatie, bewerkt alleen de titel.
  els.startSubtitle.addEventListener('click', () => editPresentationTitle());
  els.keywordTitle.addEventListener('click', (e) => { e.stopPropagation(); editTitle(); });
  // De kop van de werkafspraken wordt een knop, zodat ook de werkafspraken met Tab te bereiken zijn.
  const agreementsHeading = els.agreementsBox.querySelector('h3');
  const agreementsButton = document.createElement('button');
  agreementsButton.type = 'button';
  agreementsButton.className = 'edit-text-btn';
  agreementsButton.textContent = agreementsHeading.textContent;
  agreementsButton.title = 'Werkafspraken bewerken';
  agreementsHeading.replaceChildren(agreementsButton);
  // Doelen: een klik op de tekst (een knop) bewerkt; de knop "+ Doel toevoegen" voegt toe.
  els.goals.addEventListener('click', (e) => {
    if (e.target.closest('.goal-edit')) return;
    if (e.target.closest('.goal-add-btn')) return addGoal();
    const li = e.target.closest('.goal-text') && e.target.closest('.goal');
    if (li) editGoal(li);
  });
  els.tipsList.addEventListener('click', (e) => {
    const li = e.target.closest('li');
    const tip = li && tipsAt(pos)[[...els.tipsList.children].indexOf(li)];
    if (!tip) return;
    const i = sheetOf(tip.ref);
    showNotice(i === pos.sheet
      ? `Deze tip bewerk je via dit vel, „${flat[i].title}”: klik op de rechter flip-over of gebruik de knop Vel bewerken.`
      : `Deze tip bewerk je via het vel „${flat[i].title}”. Ga naar dat vel en klik op de rechter flip-over of gebruik de knop Vel bewerken.`);
  });
}

/* ---------- Geluid ---------- */
// Met Web Audio opgewekt, dus geen geluidsbestanden nodig. De AudioContext wordt pas
// bij het eerste geluid gemaakt: browsers staan geluid pas toe na een klik of toets.
// In de bewerkmodus (?edit) klinkt standaard niets; de knop met de luidspreker zet het geluid aan
// (en weer uit). Live klinkt het altijd.

let audio = null;
let soundOn = !editMode;

if (editMode) {
  els.soundBtn.hidden = false;
  els.soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    els.soundBtn.setAttribute('aria-pressed', String(soundOn));
    els.soundBtn.title = soundOn ? 'Geluid uit' : 'Geluid aan (de bewerkmodus is standaard stil)';
    if (soundOn) warmUpAudio(); // nu, tijdens de klik: browsers staan geluid pas toe na een handeling
    else cancelQueuedSounds();
  });
}

function getAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

// Het eerste aanmaken van een AudioContext kan honderden milliseconden duren (het besturings-
// systeem opent het geluidsapparaat). Daarom vooraf, bij het inloggen of de eerste toets of klik,
// en niet midden in een overgang. Browsers staan het pas toe na zo'n handeling van de gebruiker.
function warmUpAudio() {
  if (!soundOn || audio) return;
  try { getAudio(); } catch { /* zonder geluid gaat de presentatie gewoon door */ }
}
for (const type of ['pointerdown', 'keydown']) {
  document.addEventListener(type, warmUpAudio, { capture: true, once: true });
}

// Geluiden overlappen nooit; daar zorgt deze poort voor. Hoofdgeluiden (geritsel, vraagtoon,
// belletje) komen in een rij: klinkt er al iets, dan volgt het volgende daarna. Bij een nieuwe
// navigatie vervallen geluiden die nog in de rij stonden. De kleine geluidjes van de geeltjes
// horen bij een beweging; die vallen weg als er op dat moment al iets klinkt.
const SOUND_GAP = 40; // ms stilte tussen twee geluiden
let soundBusyUntil = 0; // performance.now() tot wanneer er (gepland) geluid is
let playingUntil = 0;   // idem, alleen voor geluid dat al echt gestart is
let soundTimers = [];

function startSound(play, seconds) {
  playingUntil = Math.max(playingUntil, performance.now() + seconds * 1000 + SOUND_GAP);
  play();
}

/** Hoofdgeluid: nu, of direct na wat er al klinkt. Geeft terug na hoeveel ms het klinkt. */
function queueSound(play, seconds) {
  if (!soundOn) return 0; // de bewerkmodus is standaard stil
  const wait = Math.max(0, soundBusyUntil - performance.now());
  soundBusyUntil = performance.now() + wait + seconds * 1000 + SOUND_GAP;
  if (wait === 0) startSound(play, seconds);
  else soundTimers.push(setTimeout(() => startSound(play, seconds), wait));
  return wait;
}

/** Klein geluidje bij een beweging: alleen als het stil is, anders vervalt het. */
function playIfQuiet(play, seconds) {
  if (!soundOn || performance.now() < soundBusyUntil) return;
  soundBusyUntil = performance.now() + seconds * 1000 + SOUND_GAP;
  startSound(play, seconds);
}

/** Bij een nieuwe navigatie: geplande geluiden vervallen; wat al klinkt, mag uitklinken. */
function cancelQueuedSounds() {
  for (const t of soundTimers) clearTimeout(t);
  soundTimers = [];
  soundBusyUntil = playingUntil;
}

const playBell = () => queueSound(bellSound, 0.6);
const playQuestionTone = () => queueSound(questionSound, 0.32);
const playPageTurn = () => queueSound(pageTurnSound, 0.55);
const playCheck = () => queueSound(checkSound, 0.34);
const playPickup = () => playIfQuiet(pickupSound, 0.18);
const playStick = () => playIfQuiet(stickSound, 0.09);
const playTap = () => playIfQuiet(tapSound, 0.07);
const playPinUp = () => queueSound(pinUpSound, 0.5);
const playPinDown = () => queueSound(pinDownSound, 0.32);

/**
 * Een vel papier tegen het whiteboard, dan twee magneten die erop klikken (0,26 en 0,41 s; zie
 * renderPin). Het papier is een korte, zachte zwiep; een klik is een kort, hard tikje met een
 * laag randje (zie magnetClick).
 */
function pinUpSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    paperSwish(ctx, now, 0.2, 0.16);
    magnetClick(ctx, now + 0.26, 1.0);
    magnetClick(ctx, now + 0.41, 0.88);
  } catch (err) {
    console.warn('Ophanggeluid kon niet worden afgespeeld:', err);
  }
}

/** Weghalen: zachter dan ophangen, maar goed hoorbaar. Twee tikjes (magneten eraf) en een zachte zwiep. */
function pinDownSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    magnetClick(ctx, now, 1.15, 0.25);
    magnetClick(ctx, now + 0.07, 1.05, 0.22);
    paperSwish(ctx, now + 0.14, 0.17, 0.06);
  } catch (err) {
    console.warn('Weghaalgeluid kon niet worden afgespeeld:', err);
  }
}

/** Papier dat langs het bord schuift: gefilterde ruis die aanzwelt en wegsterft. */
function paperSwish(ctx, t, length, level) {
  const noise = noiseSource(ctx, length);
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 0.7;
  band.frequency.setValueAtTime(1600, t);
  band.frequency.exponentialRampToValueAtTime(3200, t + length);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(level, t + length * 0.35);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  noise.connect(band).connect(env).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + length);
}

/**
 * Een magneet die tegen het bord klikt: een kort, hard tikje (metaal op een geëmailleerd bord)
 * met een snel wegstervende toon erin, en eronder een korte, lage plof voor wat gewicht. De plof
 * is een driehoeksgolf rond 200 Hz die snel zakt; de boventonen maken hem ook op laptopspeakers
 * hoorbaar. Daarbovenop een heel kort metalig randje: zes blokgolven op niet-harmonische
 * afstanden (zoals bij een synthetisch bekken), hoog gefilterd. Doordat ze niet harmonisch zijn
 * en snel wegsterven, klinkt het als metaal en niet als een noot. De aanzet is fel: het tikje
 * en het metaal staan meteen op volle sterkte (zonder aanloop), met daarvoor een knal van een
 * paar milliseconden.
 * pitch: kleine variatie per klik; level: luidheid (1 = vol).
 */
function magnetClick(ctx, t, pitch, level = 1) {
  const snap = noiseSource(ctx, 0.008);
  const snapHigh = ctx.createBiquadFilter();
  snapHigh.type = 'highpass';
  snapHigh.frequency.value = 3000;
  const snapEnv = ctx.createGain();
  snapEnv.gain.setValueAtTime(0.6 * level, t);
  snapEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.006);
  snap.connect(snapHigh).connect(snapEnv).connect(ctx.destination);
  snap.start(t);
  snap.stop(t + 0.008);

  const knock = noiseSource(ctx, 0.03);
  const high = ctx.createBiquadFilter();
  high.type = 'highpass';
  high.frequency.value = 1200;
  const knockEnv = ctx.createGain();
  knockEnv.gain.setValueAtTime(0.4 * level, t);
  knockEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
  knock.connect(high).connect(knockEnv).connect(ctx.destination);
  knock.start(t);
  knock.stop(t + 0.03);

  const ring = ctx.createOscillator();
  ring.type = 'triangle';
  ring.frequency.setValueAtTime(1350 * pitch, t);
  ring.frequency.exponentialRampToValueAtTime(900 * pitch, t + 0.05);
  const ringEnv = ctx.createGain();
  ringEnv.gain.setValueAtTime(0.0001, t);
  ringEnv.gain.exponentialRampToValueAtTime(0.12 * level, t + 0.002);
  ringEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
  ring.connect(ringEnv).connect(ctx.destination);
  ring.start(t);
  ring.stop(t + 0.07);

  const low = ctx.createOscillator();
  low.type = 'triangle';
  low.frequency.setValueAtTime(200 * pitch, t);
  low.frequency.exponentialRampToValueAtTime(110 * pitch, t + 0.07);
  const lowEnv = ctx.createGain();
  lowEnv.gain.setValueAtTime(0.0001, t);
  lowEnv.gain.exponentialRampToValueAtTime(0.45 * level, t + 0.003);
  lowEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
  low.connect(lowEnv).connect(ctx.destination);
  low.start(t);
  low.stop(t + 0.09);

  const metalBand = ctx.createBiquadFilter();
  metalBand.type = 'bandpass';
  metalBand.frequency.value = 4200;
  metalBand.Q.value = 1.2;
  const metalEnv = ctx.createGain();
  metalEnv.gain.setValueAtTime(0.16 * level, t);
  metalEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  metalBand.connect(metalEnv).connect(ctx.destination);
  for (const ratio of [2.0, 3.0, 4.16, 5.43, 6.79, 8.21]) {
    const partial = ctx.createOscillator();
    partial.type = 'square';
    partial.frequency.value = 310 * ratio * pitch;
    const mix = ctx.createGain();
    mix.gain.value = 1 / 6;
    partial.connect(mix).connect(metalBand);
    partial.start(t);
    partial.stop(t + 0.05);
  }
}

/**
 * Doffe tik van de dop van een stift tegen het papier op de flip-over (bij aanwijzen). Gedempt:
 * ruis door een laagdoorlaatfilter met een korte, zakkende toon eronder; rond 500–900 Hz, zodat
 * hij ook op laptopspeakers te horen is.
 */
function tapSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const knock = noiseSource(ctx, 0.05);
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 950;
    low.Q.value = 0.8;
    const knockEnv = ctx.createGain();
    knockEnv.gain.setValueAtTime(0.0001, now);
    knockEnv.gain.exponentialRampToValueAtTime(0.32, now + 0.002);
    knockEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
    knock.connect(low).connect(knockEnv).connect(ctx.destination);
    knock.start(now);
    knock.stop(now + 0.05);

    const body = ctx.createOscillator();
    body.type = 'sine';
    body.frequency.setValueAtTime(560, now);
    body.frequency.exponentialRampToValueAtTime(320, now + 0.05);
    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(0.0001, now);
    bodyEnv.gain.exponentialRampToValueAtTime(0.14, now + 0.003);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    body.connect(bodyEnv).connect(ctx.destination);
    body.start(now);
    body.stop(now + 0.07);
  } catch (err) {
    console.warn('Tikgeluid kon niet worden afgespeeld:', err);
  }
}

/** Ruis van een bepaalde lengte, als bron voor geritsel en geeltjesgeluiden. */
function noiseSource(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

// De geluidjes van de geeltjes zitten bewust boven ongeveer 500 Hz: laptopspeakers geven
// daaronder vrijwel niets weer, dus een echt laag tikje zou daar wegvallen.

/** Ruis met losse knispertjes erin: plakband dat loslaat. */
function crackleSource(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const crackle = Math.random() < 0.012 ? 1 : 0.35; // af en toe een harder tikje
    data[i] = (Math.random() * 2 - 1) * crackle;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

/** Oppakken van een geeltje: knisperend loslaten, met een filter dat omhoog schuift. */
function pickupSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const duration = 0.18;
    const noise = crackleSource(ctx, duration);
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 1000;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.9;
    band.frequency.setValueAtTime(1800, now);
    band.frequency.exponentialRampToValueAtTime(5500, now + 0.15);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.5, now + 0.012);
    env.gain.setValueAtTime(0.5, now + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(highpass).connect(band).connect(env).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);
  } catch (err) {
    console.warn('Oppakgeluid kon niet worden afgespeeld:', err);
  }
}

/**
 * Vastplakken van een geeltje: een korte, doffe "tok" (een zacht toontje dat snel zakt, plus een
 * gedempt klikje). Niet lager dan ongeveer 500 Hz, anders valt hij op laptopspeakers weg.
 */
function stickSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const tone = ctx.createOscillator();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(1100, now);
    tone.frequency.exponentialRampToValueAtTime(600, now + 0.05);
    const toneEnv = ctx.createGain();
    toneEnv.gain.setValueAtTime(0.0001, now);
    toneEnv.gain.exponentialRampToValueAtTime(0.16, now + 0.003);
    toneEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    tone.connect(toneEnv).connect(ctx.destination);
    tone.start(now);
    tone.stop(now + 0.09);

    const click = noiseSource(ctx, 0.03);
    const band = ctx.createBiquadFilter();
    band.type = 'lowpass';
    band.frequency.value = 1800;
    const clickEnv = ctx.createGain();
    clickEnv.gain.setValueAtTime(0.0001, now);
    clickEnv.gain.exponentialRampToValueAtTime(0.19, now + 0.002);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    click.connect(band).connect(clickEnv).connect(ctx.destination);
    click.start(now);
    click.stop(now + 0.03);
  } catch (err) {
    console.warn('Plakgeluid kon niet worden afgespeeld:', err);
  }
}

/** Willekeurig getal rond value (± spread als fractie), zodat geen twee vinkjes gelijk klinken. */
const vary = (value, spread) => value * (1 + (Math.random() * 2 - 1) * spread);

/**
 * Wrijving van een stiftpunt op het bord: ruis waarvan de sterkte onregelmatig schommelt (de punt
 * hapert steeds even: "stick-slip"), met af en toe een korrel. Dat maakt het minder mechanisch
 * dan gelijkmatige ruis.
 */
function markerTexture(ctx, seconds) {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const hop = Math.round(ctx.sampleRate / vary(170, 0.3)); // hoe vaak de druk verandert
  let level = 0.7;
  let target = 0.7;
  for (let i = 0; i < data.length; i++) {
    if (i % hop === 0) target = 0.35 + Math.random() * 0.65;
    level += (target - level) * 0.004; // zacht glijden naar de nieuwe druk
    const grain = Math.random() < 0.003 ? 1.8 : 1;
    data[i] = (Math.random() * 2 - 1) * level * grain;
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  return src;
}

/**
 * Een doel afvinken: het geluid van een stift die een vinkje zet, in twee streken (kort omlaag,
 * dan langer omhoog), gelijk met het vinkje dat getekend wordt. Elke streek is wrijving (rond
 * 2–5 kHz) plus een heel zacht, trillend stiftpiepje; aanzetten, drukken en optillen verlopen
 * zacht. Toonhoogte, lengte en textuur verschillen elke keer een beetje.
 */
function checkSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const stroke = (start, length, pitch, rise) => {
      const t = now + start;
      const end = t + length;

      // Wrijving
      const rub = markerTexture(ctx, length);
      const highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 1400;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 1.6;
      band.frequency.setValueAtTime(pitch, t);
      band.frequency.linearRampToValueAtTime(pitch * rise, end);
      const rubEnv = ctx.createGain();
      rubEnv.gain.setValueAtTime(0.0001, t);
      rubEnv.gain.exponentialRampToValueAtTime(0.4, t + 0.02);         // stift zetten
      rubEnv.gain.linearRampToValueAtTime(0.3, end - 0.04);            // druk neemt iets af
      rubEnv.gain.exponentialRampToValueAtTime(0.0001, end);           // optillen
      rub.connect(highpass).connect(band).connect(rubEnv).connect(ctx.destination);
      rub.start(t);
      rub.stop(end);

      // Stiftpiepje: zacht en trillend, net onder de wrijving
      const squeak = ctx.createOscillator();
      squeak.type = 'sine';
      squeak.frequency.setValueAtTime(pitch * 0.9, t);
      squeak.frequency.linearRampToValueAtTime(pitch * 0.9 * rise, end);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = vary(32, 0.2);
      const wobbleDepth = ctx.createGain();
      wobbleDepth.gain.value = vary(70, 0.3);
      wobble.connect(wobbleDepth).connect(squeak.frequency);
      const squeakEnv = ctx.createGain();
      squeakEnv.gain.setValueAtTime(0.0001, t);
      squeakEnv.gain.exponentialRampToValueAtTime(0.045, t + 0.03);
      squeakEnv.gain.exponentialRampToValueAtTime(0.0001, end);
      squeak.connect(squeakEnv).connect(ctx.destination);
      for (const osc of [squeak, wobble]) { osc.start(t); osc.stop(end); }
    };
    const pitch = vary(2600, 0.08);
    stroke(0, vary(0.09, 0.1), pitch, 1.15);                           // korte streek omlaag
    stroke(vary(0.12, 0.1), vary(0.19, 0.1), pitch * 1.1, 1.3);        // langere streek omhoog
  } catch (err) {
    console.warn('Schrijfgeluid kon niet worden afgespeeld:', err);
  }
}

/** Belletje bij een nieuwe tip. */
function bellSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.25;
    master.connect(ctx.destination);
    // Grondtoon plus de onharmonische boventonen van een klokje, elk met een eigen uitsterftijd.
    const partials = [[1, 0.6, 1.6], [2.76, 0.25, 0.9], [5.4, 0.12, 0.45], [8.93, 0.05, 0.25]];
    for (const [ratio, gain, decay] of partials) {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 1046.5 * ratio; // C6
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(env).connect(master);
      osc.start(now);
      osc.stop(now + decay + 0.05);
    }
  } catch (err) {
    console.warn('Belletje kon niet worden afgespeeld:', err);
  }
}

/** Korte, opgaande toon bij een vraag aan de zaal. */
function questionSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(1040, now + 0.18); // een octaaf omhoog
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    env.gain.setValueAtTime(0.22, now + 0.16);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
    osc.connect(env).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);
  } catch (err) {
    console.warn('Vraagtoon kon niet worden afgespeeld:', err);
  }
}

/** Papiergeritsel bij het omslaan van een vel: ruis door een meeschuivend bandfilter. */
function pageTurnSound() {
  try {
    const ctx = getAudio();
    const now = ctx.currentTime;
    const duration = 0.55;
    const noise = noiseSource(ctx, duration);

    // Het filter schuift van laag naar hoog en terug: het vel zwiept langs.
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(700, now);
    filter.frequency.exponentialRampToValueAtTime(3200, now + 0.22);
    filter.frequency.exponentialRampToValueAtTime(1200, now + duration);

    // Rustig aanzwellen, een paar kleine trillingen van het papier, dan wegsterven.
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
    env.gain.linearRampToValueAtTime(0.10, now + 0.14);
    env.gain.linearRampToValueAtTime(0.22, now + 0.22);
    env.gain.linearRampToValueAtTime(0.12, now + 0.30);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    noise.connect(filter).connect(env).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + duration);
  } catch (err) {
    console.warn('Omslaggeluid kon niet worden afgespeeld:', err);
  }
}

/* ---------- Animatieregister ---------- */
// Bij een nieuwe navigatie worden lopende animaties direct afgerond,
// zodat snel klikken nooit een half bijgewerkt scherm oplevert.

const running = new Set();

function animate(el, frames, options, onDone) {
  const a = el.animate(frames, options);
  const rec = { a, onDone };
  running.add(rec);
  a.onfinish = () => { running.delete(rec); if (onDone) onDone(); };
}

function finishAllAnimations() {
  for (const rec of [...running]) {
    rec.a.onfinish = null;
    rec.a.cancel();
    running.delete(rec);
    if (rec.onDone) rec.onDone();
  }
}

/* ------------------------------------------------------------------ */
/* Schalen, toetsen, adresbalk, voortgang                              */
/* ------------------------------------------------------------------ */

// Een browservenster op een laptop is breder dan 16:9 (tabbladen, adresbalk en taakbalk kosten
// hoogte). Alleen de flip-overs en het whiteboard (y = SAFE_TOP..SAFE_BOTTOM) moeten altijd
// in beeld zijn; de poten mogen onderaan wegvallen en muur en vloer lopen door (zie .stage::before).
// Daardoor kan het podium in een breed venster groter worden weergegeven.
const SAFE_TOP = 16;
const SAFE_BOTTOM = 806;

function fitStage() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  scale = Math.min(w / STAGE_W, h / (SAFE_BOTTOM - SAFE_TOP));
  const x = (w - STAGE_W * scale) / 2;
  // Past het hele podium, dan centreren. Anders zo veel mogelijk onderaan afsnijden
  // (poten en vloer) en bovenaan hooguit tot SAFE_TOP.
  const overflow = STAGE_H * scale - h;
  const y = overflow <= 0 ? -overflow / 2 : -Math.min(overflow / 2, SAFE_TOP * scale);
  els.stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}
window.addEventListener('resize', () => { if (deck) { hidePointer(false); fitStage(); } });

document.addEventListener('keydown', (e) => {
  if (!deck || e.altKey) return;
  if (e.target.closest?.('input, select, textarea')) return; // tijdens typen of kiezen niet navigeren
  if (textEditor) return; // het tekstvak regelt zijn eigen toetsen
  if (document.querySelector('dialog[open]')) return; // een venster ook (Esc sluit het, zie de browser)
  if (e.ctrlKey || e.metaKey) return; // combinaties met Ctrl of Cmd zijn van de browser (zoomen e.d.)
  // Per klik: pijltoetsen en PgUp/PgDn (dat sturen de meeste presenter-clickers). Per vel: dezelfde
  // toetsen met Shift (pijl links/rechts en PgUp/PgDn). Shift doet daarmee op een pagina niets, en
  // botst met geen browser of besturingssysteem (Ctrl+PgUp/PgDn wisselt van tabblad).
  const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown'];
  const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp'];
  const sheetKeys = { ArrowRight: nextSheet, PageDown: nextSheet, ArrowLeft: prevSheet, PageUp: prevSheet };
  if (e.shiftKey && sheetKeys[e.key]) { e.preventDefault(); sheetKeys[e.key](); }
  else if (nextKeys.includes(e.key)) { e.preventDefault(); next(); }
  else if (prevKeys.includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (isStart(pos)) return; // op het startscherm werken alleen Start, volgend vel en volledig scherm
  else if (e.key === 'w' || e.key === 'W') toggleAgreements();
  // T: tipveld (live; in de bewerkmodus gaan tips via het tekstvak van het vel). preventDefault
  // voorkomt dat de t zelf in het zojuist gefocuste tipveld belandt.
  else if ((e.key === 't' || e.key === 'T') && isContent(pos) && !editMode) { e.preventDefault(); openTipForm(); }
  else if (e.key === 'Escape' && pointed) hidePointer(true);
  else if (e.key === 'Escape' && !els.agreementsBox.hidden) toggleAgreements(false);
  // Home/End: eerste en laatste inhoud, niet het start- of afsluitscherm
  else if (e.key === 'Home') { e.preventDefault(); goTo(firstContent()); }
  else if (e.key === 'End') { e.preventDefault(); goTo(lastContent()); }
});

els.next.addEventListener('click', (e) => { e.currentTarget.blur(); next(); });
els.prev.addEventListener('click', (e) => { e.currentTarget.blur(); prev(); });
els.nextSheet.addEventListener('click', (e) => { e.currentTarget.blur(); nextSheet(); });
els.prevSheet.addEventListener('click', (e) => { e.currentTarget.blur(); prevSheet(); });
$('#btn-full').addEventListener('click', (e) => { e.currentTarget.blur(); toggleFullscreen(); });
els.agreementsBtn.addEventListener('click', (e) => { e.currentTarget.blur(); toggleAgreements(); });

/**
 * Werkafspraken tonen of verbergen (show weglaten = wisselen). Ze liggen als overlay over het
 * hele whiteboard en blijven staan tijdens het bladeren, tot je ze weer verbergt.
 */
function toggleAgreements(show = els.agreementsBox.hidden) {
  if (show && (!isContent(pos) || (deck.agreements.length === 0 && !editMode))) return;
  const box = els.agreementsBox;
  if (box.getAnimations().length) finishAllAnimations(); // nog aan het in- of uitfaden: eerst afronden
  els.agreementsBtn.setAttribute('aria-pressed', String(show));
  if (show === !box.hidden) return;
  els.agreementsEditBtn.hidden = !(editMode && show);
  if (show) {
    box.hidden = false;
    fitAgreements();
    animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  } else {
    animate(box, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }, () => { box.hidden = true; });
  }
}

/** Zet de werkafspraken op het bord. Zonder afspraken geen knop, behalve in de bewerkmodus. */
function renderAgreements() {
  els.agreements.replaceChildren(...deck.agreements.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  els.agreementsBtn.hidden = deck.agreements.length === 0 && !editMode;
  fitAgreements();
}

/** Verkleint de letters van de werkafspraken tot alles op het bord past (alleen als ze in beeld zijn). */
function fitAgreements() {
  const box = els.agreementsBox;
  if (box.hidden) return;
  let size = 40;
  els.agreements.style.setProperty('--agree-font', size + 'px');
  while (box.scrollHeight > box.clientHeight && size > 20) {
    size -= 2;
    els.agreements.style.setProperty('--agree-font', size + 'px');
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
}

// Bediening kort tonen bij muisbeweging
let hideTimer;
document.addEventListener('mousemove', () => {
  els.controls.classList.add('visible');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => els.controls.classList.remove('visible'), 2000);
});

// Positie in de adresbalk (#v3-2 = vel 3, 2 steps; #v0-0 = startscherm), zodat herladen op
// dezelfde plek uitkomt.
function updateHash() {
  history.replaceState(null, '', `#v${pos.sheet + 1}-${pos.step}`);
}

function readHash() {
  const m = /^#v(\d+)-(\d+)$/.exec(location.hash);
  if (!m) return null;
  const sheet = Number(m[1]) - 1;
  if (sheet < -1 || sheet > flat.length) return null;
  const max = isContent({ sheet }) ? flat[sheet].steps.length : 0;
  return { sheet, step: Math.min(Number(m[2]), max) };
}

/* ---------- Afbeeldingen: lijst, uploaden en verwijderen (?edit) ---------- */
// De knop "Afbeeldingen" opent een venster met miniaturen: alle uploads en alle namen die de
// inhoud ophangt (ook als het bestand ontbreekt of niet te ontsleutelen is; die staan er grijs).
// Een klik op een miniatuur kopieert de code (@naam). Uploaden zet de afbeelding in het geheugen
// (images), onder een naam uit de bestandsnaam; ze is meteen te gebruiken en gaat bij de export
// versleuteld mee (alleen als de inhoud haar gebruikt). Bestaat de naam al, dan eerst de vraag
// Vervangen/Annuleren. Verwijderen haalt de afbeelding uit de lijst en elk ophangen ervan uit de
// inhoud (na een vraag); weghalen dat daardoor niets meer doet, verdwijnt bij de export.

let uploadsPending = false; // uploads (of vervangingen) die nog niet geëxporteerd zijn

/** Alle namen die de inhoud nu ophangt. */
const usedImages = () => new Set(deck.topics.flatMap((t) => t.sheets.flatMap((sh) => sh.steps.flat())).filter((it) => it.type === 'pin').map((it) => it.image));

/** Hoe vaak een afbeelding in de inhoud wordt opgehangen. */
const pinCount = (name) => deck.topics.flatMap((t) => t.sheets.flatMap((sh) => sh.steps.flat())).filter((it) => it.type === 'pin' && it.image === name).length;

function openImagesDialog() {
  if (!editMode || textEditor) return;
  for (const name of usedImages()) loadImage(name);
  els.imagesStatus.textContent = '';
  renderImagesList();
  els.imagesDialog.showModal();
}
els.imagesClose.addEventListener('click', () => els.imagesDialog.close());
els.imagesDialog.addEventListener('close', () => els.imagesBtn.focus({ preventScroll: true }));
els.imagesUpload.addEventListener('click', () => els.imagesFile.click());
els.imagesFile.addEventListener('change', async () => {
  const files = [...els.imagesFile.files];
  els.imagesFile.value = ''; // dezelfde naam nog eens kiezen moet ook een "change" geven
  for (const file of files) await uploadImage(file);
});

function renderImagesList() {
  const used = usedImages();
  const names = [...new Set([...used, ...[...images].filter(([, info]) => info.uploaded).map(([name]) => name)])].sort();
  const items = names.map((name) => {
    const info = images.get(name);
    const li = document.createElement('li');
    li.className = 'image-tile';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'image-copy';
    copy.title = `Kopieer @${name}`;
    const thumb = document.createElement('span');
    thumb.className = 'image-thumb';
    if (info?.ok) {
      const img = document.createElement('img');
      img.src = info.url;
      img.alt = '';
      thumb.append(img);
    } else {
      thumb.classList.toggle('broken', info?.ok === false);
      thumb.textContent = info?.ok === false ? 'ontbreekt' : 'laden…';
    }
    const label = document.createElement('span');
    label.className = 'image-name';
    label.textContent = '@' + name;
    const meta = document.createElement('span');
    meta.className = 'image-meta';
    const n = used.has(name) ? pinCount(name) : 0;
    meta.textContent = [info?.uploaded ? 'geüpload' : '', n ? `${n}× opgehangen` : 'niet gebruikt', info?.ok ? `${info.w} × ${info.h}` : ''].filter(Boolean).join(' · ');
    copy.append(thumb, label, meta);
    // Voor schermlezers: de code als naam, de rest (ontbreekt/laden… en de gegevens) als
    // beschrijving; anders plakken de stukken zonder spatie aan elkaar ("@katgeüpload").
    thumb.id = `image-thumb-${name}`;
    meta.id = `image-meta-${name}`;
    copy.setAttribute('aria-label', '@' + name);
    copy.setAttribute('aria-describedby', (info?.ok ? '' : thumb.id + ' ') + meta.id);
    copy.addEventListener('click', () => copyImageCode(name));
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'image-delete';
    del.textContent = 'Verwijderen';
    del.setAttribute('aria-label', `Afbeelding ${name} verwijderen`);
    del.addEventListener('click', () => deleteImage(name));
    li.append(copy, del);
    return li;
  });
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Nog geen afbeeldingen. Upload er een, of hang er een op met @naam in het tekstvak van een vel.';
    items.push(li);
  }
  els.imagesList.replaceChildren(...items);
}

async function copyImageCode(name) {
  try {
    await navigator.clipboard.writeText('@' + name + ' ');
    els.imagesStatus.textContent = `Gekopieerd: @${name}`;
  } catch {
    els.imagesStatus.textContent = `Kopiëren lukte niet; de code is @${name}`;
  }
}

/** "Mijn Kat.PNG" → "mijn-kat": kleine letters, zonder accenten; de rest wordt een streepje. */
function imageNameOf(fileName) {
  const base = fileName.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const name = base.replace(/[^a-z0-9_-]+/g, '-').replace(/-+/g, '-').replace(/^[-_]+|-+$/g, '');
  return IMAGE_NAME.test(name) ? name : 'afbeelding';
}

async function uploadImage(file) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/jpeg' ? 'jpg' : null;
  if (!ext) {
    els.imagesStatus.textContent = `„${file.name}” is geen PNG of JPG; niet geüpload.`;
    return;
  }
  const name = imageNameOf(file.name);
  if (images.has(name) && !(await ask(`Er is al een afbeelding „${name}”. Vervangen door „${file.name}”?`, 'Vervangen'))) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    els.imagesStatus.textContent = `„${file.name}” is geen geldige afbeelding; niet geüpload.`;
    return;
  }
  const old = images.get(name);
  if (old?.url) URL.revokeObjectURL(old.url);
  images.set(name, { ok: true, url, w: img.naturalWidth, h: img.naturalHeight, bytes, ext, uploaded: true });
  uploadsPending = true;
  els.imagesStatus.textContent = `Geüpload als @${name}.`;
  if (pinShown?.image === name) renderPin(pinShown, false, 0, true);
  renderImagesList();
  updateDownload();
}

/** Uit de lijst en uit de inhoud: elk ophangen van deze afbeelding verdwijnt (na een vraag). */
async function deleteImage(name) {
  const n = pinCount(name);
  const question = n
    ? `Afbeelding „${name}” verwijderen? Hij wordt ${n === 1 ? '1 keer' : n + ' keer'} opgehangen; dat verdwijnt mee.`
    : `Afbeelding „${name}” verwijderen?`;
  if (!(await ask(question, 'Verwijderen'))) return;
  const old = images.get(name);
  if (old?.url) URL.revokeObjectURL(old.url);
  images.delete(name);
  if (n) {
    // Een klik die daardoor leeg wordt, valt weg; blijf op hetzelfde vel, hooguit op zijn laatste klik.
    for (const topic of deck.topics) {
      for (const sheet of topic.sheets) {
        for (const step of sheet.steps) for (let k = 0; k < step.length; k++) if (step[k].type === 'pin' && step[k].image === name) step.splice(k--, 1);
        sheet.steps.splice(0, sheet.steps.length, ...sheet.steps.filter((step) => step.length > 0));
      }
    }
    const model = isContent(pos) ? flat[pos.sheet].model : null;
    rebuildFlat();
    if (model) {
      const i = flat.findIndex((f) => f.model === model);
      pos = { sheet: i, step: Math.min(pos.step, flat[i].steps.length) };
    }
    render(null);
  }
  els.imagesStatus.textContent = `Afbeelding „${name}” verwijderd.`;
  renderImagesList();
}

/** Een vraag met de knoppen okLabel en Annuleren; true als er voor okLabel is gekozen. */
function ask(text, okLabel) {
  els.askText.textContent = text;
  els.askOk.textContent = okLabel;
  els.askDialog.returnValue = '';
  els.askDialog.showModal();
  els.askCancel.focus(); // veilig: Enter annuleert, tenzij je bewust naar de andere knop gaat
  return new Promise((resolve) => {
    els.askDialog.addEventListener('close', () => resolve(els.askDialog.returnValue === 'ok'), { once: true });
  });
}
els.askForm.addEventListener('submit', (e) => { e.preventDefault(); els.askDialog.close('ok'); });
els.askCancel.addEventListener('click', () => els.askDialog.close('cancel'));

/* ---------- Wijzigingen versleuteld exporteren ---------- */
// Op het afsluitscherm: wijkt de inhoud mét alle wijzigingen af van de geladen versie, dan staat
// daar groot de knop "Versleuteld exporteren" (niet in de demo). Die opent een venster dat twee
// keer om het wachtwoord vraagt; daarna gebeurt precies wat tools/encrypt.js doet: controleren
// (dezelfde regels, ook of de afbeeldingen er zijn), versleutelen (de inhoud en elke gebruikte
// afbeelding, met één sleutel), terug ontsleutelen ter controle. Het resultaat is een zip om over
// de projectmap heen uit te pakken: content.enc.json en img/naam.enc.png (of .enc.jpg). Een
// onversleutelde export is er niet.

let exportedJson = null; // de inhoud zoals voor het laatst geëxporteerd (JSON); null = nog nooit

// Waarschuwen bij sluiten of herladen zolang er wijzigingen zijn die nog niet via het
// afsluitscherm zijn gedownload, of een tekstvak of invoerveld nog open staat. De browser toont
// zijn eigen standaardvraag (een eigen tekst kan niet), en alleen als er op de pagina geklikt of
// getypt is.
window.addEventListener('beforeunload', (e) => {
  if (!deck) return;
  // Alles wat open staat en nog niet is opgeslagen: een tekstvak, een invoerveld op zijn plek
  // (titel, naam, doel) of een half getypte tip (live).
  const open = textEditor !== null || document.querySelector('.in-place') !== null
    || (!els.tipForm.hidden && els.tipInput.value.trim() !== '');
  if (demoMode && !open) return; // de demo heeft geen export: er valt niets te bewaren
  const current = JSON.stringify(contentWithChanges());
  if (!open && !uploadsPending && current === (exportedJson ?? JSON.stringify(rawContent))) return;
  e.preventDefault();
  e.returnValue = ''; // voor oudere browsers
});
const PASSWORD_WARNING = 'Let op: gebruik bij voorkeur een wachtwoord van 16 tekens of meer.'; // zoals tools/encrypt.js

els.exportBtn.addEventListener('click', () => {
  els.exportForm.reset();
  updateExportForm();
  // Geüploade afbeeldingen die de inhoud niet gebruikt, gaan niet mee: dat staat erbij.
  const unused = [...images].filter(([name, info]) => info.uploaded && !usedImages().has(name)).map(([name]) => name);
  els.exportUnused.hidden = unused.length === 0;
  els.exportUnused.textContent = unused.length === 1
    ? `Let op: de geüploade afbeelding „${unused[0]}” wordt niet gebruikt en gaat niet mee.`
    : `Let op: ${unused.length} geüploade afbeeldingen worden niet gebruikt en gaan niet mee: ${unused.join(', ')}.`;
  els.exportDialog.showModal(); // de focus gaat naar het eerste wachtwoordvak
});
els.exportCancel.addEventListener('click', () => els.exportDialog.close());
els.exportDialog.addEventListener('close', () => els.exportBtn.focus({ preventScroll: true })); // ook na Esc
els.exportPw1.addEventListener('input', updateExportForm);
els.exportPw2.addEventListener('input', updateExportForm);
els.exportForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!els.exportOk.disabled) exportEncrypted(els.exportPw1.value);
});

/** Exporteren kan pas als beide vakken gevuld en gelijk zijn; de melding zegt wat er nog mist. */
function updateExportForm() {
  const a = els.exportPw1.value;
  const b = els.exportPw2.value;
  els.exportOk.disabled = a === '' || a !== b;
  els.exportStatus.classList.remove('error');
  els.exportStatus.textContent = a && b && a !== b ? 'De wachtwoorden zijn niet gelijk.' : a && a.length < 16 ? PASSWORD_WARNING : '';
}

/** Zoals tools/encrypt.js: controleren, versleutelen, controleren; dan de zip downloaden. */
async function exportEncrypted(password) {
  const fail = (lines) => {
    els.exportStatus.classList.add('error');
    els.exportStatus.textContent = lines.join('\n');
    els.exportOk.textContent = 'Exporteren';
    els.exportOk.disabled = false;
  };
  els.exportOk.disabled = true;
  els.exportOk.textContent = 'Bezig…';
  els.exportStatus.classList.remove('error');
  els.exportStatus.textContent = '';
  try {
    // Eerst weghalen wat niets doet (weghalen terwijl er niets hangt), dan dezelfde controle als
    // het script; normalizeContent schoont content op zijn plek op.
    const content = contentWithChanges();
    dropDeadUnpins(content);
    const check = normalizeContent(content);
    const pins = check.content.topics.flatMap((t) => t.sheets.flatMap((sh) => sh.steps.flat())).filter((it) => it.type === 'pin');
    const names = [...new Set(pins.map((it) => it.image))];
    for (const name of names) {
      loadImage(name);
      await images.get(name); // laadt hij nog, dan wachten
      if (!images.get(name).ok) check.errors.push(`afbeelding "${name}" ${images.get(name).why}.`);
    }
    if (check.errors.length) return fail(['Niet geëxporteerd: los eerst deze fouten op.', ...check.errors.map((err) => '• ' + err)]);

    // Eén sleutel voor alles (zie crypto-core.js); ter controle alles weer ontsleutelen, de inhoud
    // met het wachtwoord (zoals bij het inloggen) en de afbeeldingen met de sleutel daarvan.
    const text = JSON.stringify(content);
    const k = await newKey(password);
    const payload = await encryptTextWith(text, k);
    const checkKey = await payloadKey(payload, password);
    if (await decryptTextWith(payload, checkKey) !== text) throw new Error('Controle mislukt: ontsleutelde inhoud wijkt af.');
    const files = [{ name: 'content.enc.json', bytes: new TextEncoder().encode(JSON.stringify(payload, null, 2) + '\n') }];
    for (const name of names) {
      const { bytes, ext } = images.get(name);
      const encrypted = await encryptBytes(bytes, k.key);
      const back = await decryptBytes(encrypted, checkKey);
      if (back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error(`Controle mislukt: afbeelding "${name}" wijkt af.`);
      files.push({ name: `img/${name}.enc.${ext}`, bytes: encrypted });
    }

    const zipName = `presentatie-${new Date().toLocaleDateString('sv')}.zip`; // JJJJ-MM-DD, lokale datum
    const url = URL.createObjectURL(await zipFiles(files));
    const a = document.createElement('a');
    a.href = url;
    a.download = zipName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    exportedJson = JSON.stringify(contentWithChanges());
    uploadsPending = false;
    els.exportDialog.close();
    els.exportForm.reset();
    const imgNote = names.length ? ` en ${names.length === 1 ? '1 afbeelding' : names.length + ' afbeeldingen'} in img/` : '';
    els.endNote.textContent = `Geëxporteerd als ${zipName} (gecontroleerd): content.enc.json${imgNote}. Pak hem uit over de projectmap heen.`;
  } catch (err) {
    fail(['Niet geëxporteerd: ' + err.message]);
  }
}

/**
 * Haalt elke unpin weg waarbij het whiteboard al leeg is (in de volgorde van de presentatie),
 * bijvoorbeeld na het verwijderen van een afbeelding. Een klik die daardoor leeg wordt, valt weg.
 * Werkt op de JSON van contentWithChanges (op zijn plek).
 */
function dropDeadUnpins(content) {
  let hanging = false;
  for (const topic of content.topics) {
    for (const sheet of topic.sheets) {
      for (const step of sheet.steps) {
        for (let k = 0; k < step.length; k++) {
          if (step[k].type === 'pin') hanging = true;
          else if (step[k].type === 'unpin') { if (hanging) hanging = false; else step.splice(k--, 1); }
        }
      }
      sheet.steps = sheet.steps.filter((step) => step.length > 0);
    }
  }
}

function updateDownload() {
  const updated = isEnd(pos) && !demoMode ? contentWithChanges() : null;
  const changed = updated !== null && (uploadsPending || JSON.stringify(updated) !== JSON.stringify(rawContent));
  els.endDownload.hidden = !changed;
  if (!changed) return;

  // Tellen: wat er nu in het model staat, vergeleken met de items zoals geladen.
  const now = new Set(flat.flatMap((f) => f.steps.flat()));
  const count = (n, what) => (n === 1 ? '1 onderdeel ' : n + ' onderdelen ') + what;
  const added = [...now].filter((it) => !original.has(it)).length;
  const edited = [...now].filter((it) => original.has(it) && JSON.stringify(it) !== original.get(it)).length;
  const removed = [...original.keys()].filter((it) => !now.has(it)).length;
  const sheetsNow = deck.topics.flatMap((t) => t.sheets);
  const sheetsAdded = sheetsNow.filter((sh) => !originalSheets.has(sh)).length;
  const sheetsRemoved = [...originalSheets.keys()].filter((sh) => !sheetsNow.includes(sh)).length;
  const titles = sheetsNow.filter((sh) => originalSheets.has(sh) && sh.title !== originalSheets.get(sh).title).length;
  const sorted = (list) => list.every((n, i) => i === 0 || list[i - 1] < n);
  const topicOrder = !sorted(deck.topics.filter((t) => originalTopics.has(t)).map((t) => originalTopics.get(t).index));
  const sheetOrder = !sorted(sheetsNow.filter((sh) => originalSheets.has(sh)).map((sh) => originalSheets.get(sh).order));
  const sheetsMoved = deck.topics.flatMap((t) => t.sheets.filter((sh) => originalSheets.has(sh) && originalSheets.get(sh).topic !== t)).length;
  const sheetsCount = (n, what) => (n === 1 ? '1 vel ' : n + ' vellen ') + what;
  const topicsAdded = deck.topics.filter((t) => !originalTopics.has(t)).length;
  const topicsRemoved = [...originalTopics.keys()].filter((t) => !deck.topics.includes(t)).length;
  const topicsRenamed = deck.topics.filter((t) => originalTopics.has(t) && t.sticky !== originalTopics.get(t).name).length;
  const topicsCount = (n, what) => (n === 1 ? '1 onderwerp ' : n + ' onderwerpen ') + what;
  const parts = [];
  if (topicsAdded) parts.push(topicsCount(topicsAdded, 'toegevoegd'));
  if (topicsRemoved) parts.push(topicsCount(topicsRemoved, 'verwijderd'));
  if (topicsRenamed) parts.push(topicsRenamed === 1 ? '1 onderwerpnaam gewijzigd' : topicsRenamed + ' onderwerpnamen gewijzigd');
  if (sheetsAdded) parts.push(sheetsCount(sheetsAdded, 'toegevoegd'));
  if (sheetsRemoved) parts.push(sheetsCount(sheetsRemoved, 'verwijderd'));
  if (titles) parts.push(titles === 1 ? '1 veltitel gewijzigd' : titles + ' veltitels gewijzigd');
  if (topicOrder) parts.push('de volgorde van de onderwerpen gewijzigd');
  if (sheetOrder) parts.push('de volgorde van de vellen gewijzigd');
  if (sheetsMoved) parts.push(sheetsCount(sheetsMoved, 'naar een ander onderwerp verplaatst'));
  if (added) parts.push(count(added, 'toegevoegd'));
  if (edited) parts.push(count(edited, 'bewerkt'));
  if (removed) parts.push(count(removed, 'verwijderd'));
  if (agreementsChanged()) parts.push('de werkafspraken gewijzigd');
  if (goalsChanged()) parts.push('de doelen gewijzigd');
  if (deck.title !== loadedTitle) parts.push('de titel van de presentatie gewijzigd');
  if (uploadsPending) parts.push('afbeeldingen geüpload of vervangen');
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' en ' + parts.at(-1) : parts[0] ?? 'de indeling in klikken gewijzigd';
  els.endNote.textContent = `Je hebt ${list}. `
    + (exportedJson === JSON.stringify(updated) && !uploadsPending ? 'Dit is al geëxporteerd.' : 'Exporteer versleuteld en pak de zip uit over de projectmap heen.');
}

/** Zijn de doelen anders dan bij het laden? */
const goalsChanged = () => JSON.stringify(deck.goals) !== loadedGoals;

/** Zijn de werkafspraken anders dan in de geladen inhoud? */
function agreementsChanged() {
  const loaded = Array.isArray(rawContent.agreements) ? rawContent.agreements.map(String) : [];
  return JSON.stringify(deck.agreements) !== JSON.stringify(loaded);
}

/**
 * De geladen inhoud met alle wijzigingen. Werkt op een kopie van de originele JSON; de
 * onderwerpen en hun vellen (namen, titels, klikken, volgorde, ook toegevoegde en verwijderde)
 * komen altijd uit het model. Zonder wijzigingen is dat precies wat er geladen is; ongeldige
 * items, die de motor al oversloeg, vallen weg. De titel, de werkafspraken en de doelen alleen
 * als ze gewijzigd zijn.
 */
function contentWithChanges() {
  const copy = structuredClone(rawContent);
  copy.topics = deck.topics.map((topic) => {
    const loaded = originalTopics.has(topic) ? copy.topics[originalTopics.get(topic).index] : null;
    const base = loaded && typeof loaded === 'object' && !Array.isArray(loaded) ? loaded : {};
    return { ...base, sticky: topic.sticky, sheets: topic.sheets.map((sheet) => ({ title: sheet.title, steps: structuredClone(sheet.steps) })) };
  });
  if (agreementsChanged()) copy.agreements = [...deck.agreements];
  if (goalsChanged()) copy.goals = deck.goals.map((g) => ({ id: g.id, text: g.text }));
  if (deck.title !== loadedTitle) copy.title = deck.title;
  return copy;
}

/* ---------- Vellen afdrukken (PDF) ---------- */
// Op het afsluitscherm: alle vellen met hun volledige inhoud (zoals vlak voordat het vel omslaat)
// en het vel met alle tips, elk op een eigen A4 (staand), met de titel van de presentatie en de
// datum. Het whiteboard gaat niet mee. De browser maakt de PDF ("Opslaan als PDF" in het
// afdrukvenster), zodat de tekst scherp en doorzoekbaar blijft. Ctrl+P geeft hetzelfde resultaat.
// De inhoud komt uit het model: tips en bewerkingen van tijdens de presentatie gaan mee.

// Hoogte van een vel op het podium (.pad 690px min 12px voor de stapel eronder). Een vel op
// papier krijgt dezelfde hoogte en dus dezelfde letters en marges; alleen de breedte volgt de
// verhouding van het papier (breder, dus minder afgebroken regels). Daarna wordt het geschaald.
const PRINT_SHEET_H = 678;

let printReady = false;
let titleBeforePrint = '';

els.pdf.addEventListener('click', async () => {
  await document.fonts?.ready; // de handschriftletters moeten geladen zijn vóór het meten
  preparePrint();
  window.print();
});

// Ook Ctrl+P (of het menu van de browser) drukt de vellen af, niet het podium.
window.addEventListener('beforeprint', () => preparePrint());
window.addEventListener('afterprint', () => {
  if (!printReady) return;
  printReady = false;
  document.title = titleBeforePrint;
  document.documentElement.classList.remove('print-sheets');
  els.print.replaceChildren();
});

function preparePrint() {
  if (printReady || !deck) return; // vóór het inloggen: gewoon afdrukken wat er staat
  printReady = true;
  const now = new Date();
  const date = new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long' }).format(now);
  const title = deck.title;
  // De paginatitel wordt de voorgestelde bestandsnaam van de PDF.
  titleBeforePrint = document.title;
  document.title = `${title} – vellen – ${date}`;
  document.documentElement.classList.add('print-sheets');

  const root = els.print;
  root.replaceChildren();
  const page = { title, date, iso: now.toISOString().slice(0, 10) };
  const pages = [];
  const tips = tipsAt({ sheet: flat.length, step: 0 });
  if (tips.length) pages.push(...printSheet(page, 'tips', 'Tips', tips, 'Alle tips uit de presentatie'));
  flat.forEach((f, i) => {
    pages.push(...printSheet(page, 'keywords', f.title, keywordsAt({ sheet: i, step: f.steps.length }), 'Onderwerp: ' + deck.topics[f.topic].sticky));
  });
  pages.forEach((el, i) => { el.querySelector('.print-pagenr').textContent = `Pagina ${i + 1} van ${pages.length}`; });
}

/**
 * Eén vel als A4-pagina('s). Past het vel ook met de kleinste letters niet, dan gaan de
 * laatste regels naar een volgende pagina met dezelfde titel en "(vervolg)".
 */
function printSheet(page, kind, heading, items, footer) {
  const out = [];
  let rest = items;
  do {
    const el = createPrintPage(page, kind, out.length ? heading + ' (vervolg)' : heading, footer);
    els.print.append(el);
    const sheet = el.querySelector('.sheet');
    const ul = sheet.querySelector('ul');
    sizePrintSheet(el.querySelector('.print-sheet-box'), sheet);
    ul.replaceChildren(...rest.map(createListItem));
    renumber(ul);
    fitList(sheet, ul, LIST_FONT_MAX, kind === 'tips' ? 18 : 20);
    let n = rest.length;
    while (n > 1 && sheet.scrollHeight > sheet.clientHeight) { ul.lastChild.remove(); n--; }
    out.push(el);
    rest = rest.slice(n);
  } while (rest.length);
  return out;
}

function createPrintPage(page, kind, heading, footer) {
  const el = document.createElement('section');
  el.className = 'print-page';
  el.innerHTML = `
    <header class="print-header"><span class="print-title"></span><time class="print-date"></time></header>
    <div class="print-sheet-box"><div class="sheet print-sheet"><h2></h2><ul class="sheet-list"></ul></div></div>
    <footer class="print-footer"><span class="print-topic"></span><span class="print-pagenr"></span></footer>`;
  el.querySelector('.print-title').textContent = page.title;
  const time = el.querySelector('.print-date');
  time.textContent = page.date;
  time.dateTime = page.iso;
  el.querySelector('.print-topic').textContent = footer;
  const h = el.querySelector('h2');
  h.className = kind === 'tips' ? 'sheet-heading' : 'sheet-title';
  h.textContent = heading;
  el.querySelector('ul').classList.add(kind === 'tips' ? 'tips-list' : 'keyword-list');
  return el;
}

/** Maakt het vel even hoog als op het podium, zo breed als het papier toelaat, en schaalt het in het vak. */
function sizePrintSheet(box, sheet) {
  const s = box.clientHeight / PRINT_SHEET_H;
  sheet.style.width = box.clientWidth / s + 'px';
  sheet.style.height = PRINT_SHEET_H + 'px';
  sheet.style.transform = `scale(${s})`;
}

function updateProgress() {
  const t = topicAt(pos);
  els.progress.textContent = isStart(pos) ? 'Welkom' : isEnd(pos) ? 'Einde' : `${t + 1} / ${deck.topics.length}`;
}
