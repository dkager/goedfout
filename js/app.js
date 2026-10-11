// Presentatiemotor: whiteboard met kanban en vraagzone (werkafspraken op verzoek als overlay),
// flip-over links (tips) en rechts (steekwoorden). Alle weergave wordt afgeleid uit één positie:
//   pos = { sheet: index in de platte lijst van vellen, step: aantal uitgevoerde steps (klikken) }
// sheet === -1 is het donkere startscherm, sheet === aantal vellen het donkere afsluitscherm.
// Een step is een lijst van items (keyword, tip, question) die bij één klik verschijnen.

import { decryptText, WrongPasswordError } from './crypto-core.js';
import { normalizeContent, KEYWORD_COLORS, KEYWORD_INDENTS, KEYWORD_GAPS } from './content.js';

const STAGE_W = 1600;
const STAGE_H = 900;
// Grootste lettergrootte op de flip-overs (tips en steekwoorden), ook op een bijna leeg vel.
// Kleiner wordt het alleen als een vel vol raakt (tot de minPx van fitList).
const LIST_FONT_MAX = 32; // px

const $ = (sel) => document.querySelector(sel);
const els = {
  login: $('#login'),
  form: $('#login-form'),
  password: $('#password'),
  loginError: $('#login-error'),
  viewport: $('#viewport'),
  stage: $('#stage'),
  tipsSheet: $('#tips-sheet'),
  tipsList: $('#tips-list'),
  tipsAnnouncer: $('#tips-announcer'),
  keywordPad: $('#keyword-pad'),
  keywordSheet: $('#keyword-sheet'),
  keywordList: $('#keyword-list'),
  keywordTitle: $('#keyword-title'),
  agreements: $('#agreements-list'),
  goals: $('#goals-list'),
  agreementsBox: $('#agreements'),
  agreementsBtn: $('#btn-agreements'),
  kanban: $('.kanban'),
  cols: { todo: $('#col-todo'), doing: $('#col-doing'), done: $('#col-done') },
  addTip: $('#add-tip'),
  tipForm: $('#tip-form'),
  tipInput: $('#tip-input'),
  addBtn: $('#btn-add'),
  addMenu: $('#add-menu'),
  question: $('#wb-question'),
  questionText: $('#wb-question-text'),
  progress: $('#progress'),
  prev: $('#btn-prev'),
  next: $('#btn-next'),
  startScreen: $('#start-screen'),
  endScreen: $('#end-screen'),
  endDownload: $('#end-download'),
  endNote: $('#end-note'),
  download: $('#btn-download'),
  pdf: $('#btn-pdf'),
  print: $('#print'),
  controls: document.querySelector('.controls'),
};

let rawContent = null;    // de inhoud precies zoals geladen (nooit gewijzigd), voor de export
let deck = null;          // het model: genormaliseerde kopie van de inhoud; wijzigingen gaan hierin
let flat = [];            // [{ topic, sheet, title, steps: [[item, …], …] }] (dezelfde arrays als in deck)
let firstSheetOfTopic = [];
let pos = { sheet: 0, step: 0 };
let stickies = [];        // knop-elementen, index = onderwerp
let stickyFontPx = 22;    // maximale lettergrootte op een geeltje, gezet door buildStickies()
let scale = 1;
let generation = 0;       // verhoogd bij elke navigatie; oude animatiestappen stoppen dan
// Wijzigingen (alleen in het geheugen) gaan direct in het model: tips die tijdens de presentatie
// worden toegevoegd (type tip, user: true), en in de bewerkmodus bewerken, toevoegen,
// verwijderen en klikken splitsen of samenvoegen. Voor de export en de telling op het
// afsluitscherm houden we bij:
const original = new Map();     // item uit de inhoud → JSON zoals geladen (om bewerkingen te tellen)
const dirtySheets = new Set();  // indexen in flat van vellen die gewijzigd zijn
const editMode = new URLSearchParams(location.search).has('edit');

/* ------------------------------------------------------------------ */
/* Laden en ontsleutelen                                               */
/* ------------------------------------------------------------------ */

const isLocalhost = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
const usePlain = isLocalhost && new URLSearchParams(location.search).has('plain');

async function loadContent(password) {
  if (usePlain) {
    // Alleen voor lokaal ontwikkelen: laadt de onversleutelde content.json.
    const r = await fetch('content.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('content.json niet gevonden (' + r.status + ')');
    return r.json();
  }
  const r = await fetch('content.enc.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('De presentatie kon niet worden geladen (' + r.status + ').');
  const payload = await r.json();
  return JSON.parse(await decryptText(payload, password));
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

if (usePlain) {
  loadContent().then(start).catch((err) => { els.loginError.textContent = err.message; });
}

/* ------------------------------------------------------------------ */
/* Opstarten                                                           */
/* ------------------------------------------------------------------ */

function start(raw) {
  // Het model is een kopie, zodat raw het origineel blijft om mee te vergelijken.
  const { content, problems, errors } = normalizeContent(structuredClone(raw));
  for (const p of problems) console.warn(p);
  // Fouten (zoals een vel zonder titel) tonen we toch, zodat je met ?plain kunt doorwerken;
  // tools/encrypt.js weigert ze wel.
  for (const e of errors) console.error(e);
  rawContent = raw;
  deck = content;
  document.title = deck.title;
  // De titel uit de JSON ook op het startscherm, onder "WELKOM" (zonder title in de JSON: niets).
  const subtitle = $('#start-subtitle');
  subtitle.textContent = typeof raw.title === 'string' ? raw.title.trim() : '';
  subtitle.hidden = subtitle.textContent === '';

  flat = [];
  firstSheetOfTopic = [];
  deck.topics.forEach((topic, t) => {
    firstSheetOfTopic[t] = flat.length;
    topic.sheets.forEach((sheet, s) => flat.push({ topic: t, sheet: s, title: sheet.title, steps: sheet.steps }));
  });
  for (const f of flat) for (const step of f.steps) for (const item of step) original.set(item, JSON.stringify(item));

  // Werkafspraken (standaard verborgen; zonder afspraken ook geen knop)
  els.agreements.replaceChildren(...deck.agreements.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
  els.agreementsBtn.hidden = deck.agreements.length === 0;

  // Doelen bovenaan het whiteboard: per doel een vakje (met een nog onzichtbaar vinkje) en de
  // tekst. Voor schermlezers staat de toestand er als tekst bij.
  els.goals.replaceChildren(...deck.goals.map((goal) => {
    const li = document.createElement('li');
    li.className = 'goal';
    li.dataset.goal = goal.id;
    li.innerHTML = '<span class="goal-box" aria-hidden="true"><svg class="goal-check" viewBox="0 0 40 40"><path d="M7 22 L16 31 L35 6"/></svg></span>';
    const text = document.createElement('span');
    text.className = 'goal-text';
    text.textContent = goal.text;
    const state = document.createElement('span');
    state.className = 'sr-only';
    li.append(text, state);
    return li;
  }));
  els.goals.hidden = deck.goals.length === 0;

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

/** Past alle tekstgroottes opnieuw aan de beschikbare ruimte aan. */
function refitText() {
  if (els.stage.hidden) return; // er valt niets te meten; showStage() past alles opnieuw
  applyStickySize();
  fitStickyText(stickyFontPx);
  fitList(els.tipsSheet, els.tipsList, LIST_FONT_MAX, 18);
  fitList(els.keywordSheet, els.keywordSheet.querySelector('ul'), LIST_FONT_MAX, 20);
  if (!els.question.hidden) fitQuestion();
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
      b.blur(); // zodat spatie daarna "volgende" blijft
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

// Regels op de flip-overs: { text, …eigenschappen, ref }. ref is het item in het model, zodat
// een regel bewerkt kan worden.
function keywordsAt(p) {
  return shownItems(p).filter((it) => it.type === 'keyword').map((it) => ({
    text: it.text, color: colorOf(it), indent: indentOf(it), numbered: it.numbered === true, gap: gapOf(it), ref: it,
  }));
}

/** Alle tips tot en met positie p, in volgorde (tips blijven staan over de vellen heen). */
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

function goTo(target) {
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
  if (previous !== null && question !== null) playQuestionTone();
  const tipsAdded = previous !== null && tipsAt(pos).length > tipsAt(previous).length;
  if (tipsAdded) playBell();
  // Nieuwe tips voorlezen, alleen die van de huidige klik: een sprong naar een ander onderwerp
  // begint op een leeg vel en leest dus niet alle tips van de tussenliggende vellen voor.
  // Zonder nieuwe tips wordt de voorleesregel leeggemaakt.
  announceTips(tipsAdded ? (currentStep(pos) ?? []).filter((it) => it.type === 'tip').map((it) => 'Tip: ' + it.text) : []);
  // Het vinkje wordt getekend op het moment dat het schrijfgeluid klinkt (dat kan na de andere zijn).
  const checkAt = newlyChecked.length ? playCheck() : 0;
  renderGoals(goalsDone, animate ? newlyChecked : [], checkAt);

  // Tips links
  renderTips(animate);

  // Steekwoorden rechts (met omslaand vel als het vel verandert). Niet van of naar het start-
  // of afsluitscherm: dan valt er niets om te slaan.
  if (sheetTurned && animate) turnSheet(pos.sheet > previous.sheet);
  els.keywordTitle.textContent = titleAt(pos);
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
  b.disabled = isEnd(pos);
  b.textContent = label ? label + ' ›' : '›';
  b.title = isStart(pos) ? 'Presentatie starten (→)' : label ? 'Naar het afsluitscherm (→)' : 'Volgende (→)';
  els.prev.disabled = isStart(pos);
  els.addBtn.disabled = !isContent(pos); // niets toevoegen op het start- of afsluitscherm
  els.agreementsBtn.disabled = !isContent(pos);
  if (!isContent(pos)) closeAddMenu();
}

/**
 * Zet de vinkjes bij de doelen. Een net afgevinkt doel krijgt zijn vinkje "getekend" (na delay
 * ms, gelijk met het schrijfgeluid); de rest staat er meteen of verdwijnt meteen.
 */
function renderGoals(checked, drawIds, delay) {
  for (const li of els.goals.children) {
    const on = checked.has(li.dataset.goal);
    li.classList.toggle('checked', on);
    li.querySelector('.sr-only').textContent = on ? ' (afgevinkt)' : ' (nog niet afgevinkt)';
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
 * Laat een schermlezer nieuwe tips voorlezen (de voorleesregel is een aria-live-regio). Eerst
 * leegmaken en pas daarna vullen, zodat ook dezelfde tekst nog eens wordt voorgelezen.
 */
function announceTips(texts) {
  const el = els.tipsAnnouncer;
  el.textContent = '';
  if (texts.length) setTimeout(() => { el.textContent = texts.join(' '); }, 50);
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

/** Zet de eigenschappen van een keyword op een regel (ook live tijdens het bewerken). */
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
  col.insertBefore(el, before || null);
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
// Plusje op de Tips-flip-over → één regel invoer. Enter (of wegklikken) voegt toe, Esc annuleert.

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
  dirtySheets.add(pos.sheet);
  finishAllAnimations();
  playBell();
  announceTips(['Tip toegevoegd: ' + text]);
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

/* ---------- Bewerken (?edit) ---------- */
// Klik op een tip, steekwoord of vraag: er verschijnt een tekstvak met de focus erop, met de
// Verwijder-knop ernaast en de instellingen van dat item eronder. Enter of wegklikken slaat de
// tekst op, Esc annuleert hem; leeg opslaan geldt als annuleren. Instellingen (kleur,
// inspringen, genummerd, ruimte erboven, nieuwe klik) gelden en worden bewaard zodra je ze
// kiest. Alles gaat direct in het model; de export op het afsluitscherm neemt het over.

const fresh = new Set(); // items die net via "Toevoegen" zijn gemaakt en nog niet zijn ingevuld

const TRASH_ICON = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.6 6.5v4.5M9.4 6.5v4.5"/></svg>';
const LABELS = { keyword: 'Steekwoord', tip: 'Tip', question: 'Vraag' };

/** Waar staat dit item in het model? { i: vel in flat, s: step, k: plek in de step } */
function locate(item) {
  for (let i = 0; i < flat.length; i++) {
    const steps = flat[i].steps;
    for (let s = 0; s < steps.length; s++) {
      const k = steps[s].indexOf(item);
      if (k >= 0) return { i, s, k };
    }
  }
  return null;
}

/** Zet een eigenschap op een item; undefined betekent: weglaten uit de JSON (de standaard). */
function setProp(item, name, value) {
  if (value === undefined) delete item[name]; else item[name] = value;
  dirtySheets.add(locate(item).i);
}

/** Alles wat bewerkt kan zijn opnieuw tekenen, zonder animatie. */
function rerenderContent() {
  renderTips(false);
  setList(els.keywordList, keywordsAt(pos), false);
  fitList(els.keywordSheet, els.keywordList, LIST_FONT_MAX, 20);
  showQuestion(questionAt(pos), false);
}

/** De regel (of de vraagtekst) waarin een item nu getoond wordt, of null. */
function hostOf(item) {
  if (item.type === 'question') return questionItemAt(pos) === item ? els.questionText : null;
  const isKeyword = item.type === 'keyword';
  const items = isKeyword ? keywordsAt(pos) : tipsAt(pos);
  const index = items.findIndex((it) => it.ref === item);
  return index < 0 ? null : (isKeyword ? els.keywordList : els.tipsList).children[index];
}

/**
 * Opent het tekstvak voor een item, met de Verwijder-knop ernaast en de instellingen eronder.
 * focus: wat de focus krijgt ('text', of de naam van een instelling, bijv. na een nieuwe klik).
 */
function editItem(item, focus = 'text') {
  const host = hostOf(item);
  if (!host || host.querySelector('.edit-box')) return;
  const label = LABELS[item.type];
  let done = false;
  // Sluit het vak: regel leegmaken en de sleutel weghalen, zodat setList hem bij het opnieuw
  // tekenen zeker opnieuw opbouwt (anders blijft dit vak staan als de tekst niet veranderde).
  const close = () => {
    done = true;
    host.replaceChildren();
    delete host.dataset.key;
  };

  // Tekstvak: groeit mee en breekt af zoals de regel zelf. Enter slaat op.
  const input = document.createElement('textarea');
  input.rows = 1;
  input.className = 'inline-edit';
  input.value = item.text;
  input.setAttribute('aria-label', label + ' bewerken');
  const autosize = () => { input.style.height = 'auto'; input.style.height = input.scrollHeight + 'px'; };
  input.addEventListener('input', autosize);
  const typed = () => input.value.replace(/\s+/g, ' ').trim(); // geplakte regeleinden worden spaties

  // Verwijder-knop direct naast (en in de DOM direct na) het tekstvak.
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'edit-delete';
  del.innerHTML = TRASH_ICON;
  del.title = 'Verwijderen';
  del.setAttribute('aria-label', label + ' verwijderen');
  del.addEventListener('mousedown', (e) => e.preventDefault()); // anders slaat "wegklikken" eerst op
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    if (done) return;
    close();
    deleteItem(item);
  });
  const row = document.createElement('div');
  row.className = 'edit-row';
  row.append(input, del);

  // Instellingen: gelden direct en blijven bewaard, ook als de tekst daarna wordt geannuleerd.
  const opts = document.createElement('div');
  opts.className = 'edit-opts';
  const controls = {};
  const addSelect = (name, aria, options, value, onChange) => {
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', aria);
    for (const [v, text] of options) sel.add(new Option(text, v));
    sel.value = value;
    sel.addEventListener('change', () => onChange(sel.value));
    opts.append(sel);
    controls[name] = sel;
  };
  const addCheck = (name, text, checked, onChange, why = '') => {
    const lab = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = checked;
    cb.disabled = Boolean(why);
    if (why) lab.title = why;
    cb.addEventListener('change', () => onChange(cb.checked));
    lab.append(cb, ' ' + text);
    opts.append(lab);
    controls[name] = cb;
  };

  if (item.type === 'keyword') {
    // Live bijwerken, zonder het tekstvak te sluiten.
    const refresh = () => {
      applyKeywordLook(host, keywordsAt(pos).find((it) => it.ref === item));
      renumber(els.keywordList);
      fitList(els.keywordSheet, els.keywordList, LIST_FONT_MAX, 20);
    };
    addSelect('color', 'Kleur', [['default', 'default'], ...[...KEYWORD_COLORS].map((c) => [c, c])],
      colorOf(item) ?? 'default', (v) => { setProp(item, 'color', v === 'default' ? undefined : v); refresh(); });
    addSelect('indent', 'Inspringen', KEYWORD_INDENTS.map((n) => [String(n), 'inspring ' + n]),
      String(indentOf(item)), (v) => { setProp(item, 'indent', v === '0' ? undefined : Number(v)); refresh(); });
    addCheck('numbered', 'genummerd', item.numbered === true,
      (on) => { setProp(item, 'numbered', on ? true : undefined); refresh(); });
    addSelect('gap', 'Ruimte erboven', [['', 'geen ruimte'], ['space', 'witruimte'], ['line', 'lijn']],
      gapOf(item) ?? '', (v) => { setProp(item, 'gap', v || undefined); refresh(); });
  }

  if (item.type === 'tip') {
    // user: tip die tijdens de presentatie is toegevoegd (rood plusje in plaats van een ster).
    addCheck('user', 'tijdens presentatie', item.user === true, (on) => {
      setProp(item, 'user', on ? true : undefined);
      host.classList.toggle('user', on); // direct zichtbaar
    });
    controls.user.parentElement.title = 'Toegevoegd tijdens de presentatie ("user": true): rood plusje in plaats van een ster';
  }

  // Nieuwe klik: aangevinkt = dit item begint een eigen klik. Aanvinken splitst de klik vóór dit
  // item, uitvinken voegt hem samen met de vorige. Het eerste item van een vel begint altijd een
  // klik, en samenvoegen kan niet als beide klikken een vraag hebben.
  const { i, s, k } = locate(item);
  const steps = flat[i].steps;
  const hasQuestion = (step) => step.some((it) => it.type === 'question');
  const why = k === 0 && s === 0 ? 'Het eerste item van een vel begint altijd een klik'
    : k === 0 && hasQuestion(steps[s - 1]) && hasQuestion(steps[s]) ? 'Samenvoegen kan niet: beide klikken hebben een vraag'
    : '';
  addCheck('newClick', 'nieuwe klik', k === 0, (on) => {
    if (done) return;
    const value = typed();
    close();
    if (value) { item.text = value; fresh.delete(item); }
    setNewClick(item, on);
    render(null);
    editItem(item, 'newClick'); // hetzelfde item blijft open, nu op zijn nieuwe plek
  }, why);

  const box = document.createElement('div');
  box.className = 'edit-box';
  box.append(row, opts);

  const finish = (keep) => {
    if (done) return;
    const value = typed();
    close();
    if (keep && value) {
      if (value !== item.text) { item.text = value; dirtySheets.add(locate(item).i); }
      fresh.delete(item);
    } else if (fresh.has(item)) {
      return deleteItem(item); // nieuw en nooit ingevuld: weer weg
    }
    rerenderContent();
  };
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target === input) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  // Wegklikken slaat op; naar een instelling gaan (binnen het vak) niet.
  box.addEventListener('focusout', (e) => { if (!box.contains(e.relatedTarget)) finish(true); });

  host.replaceChildren(box);
  autosize();
  (controls[focus] ?? input).focus({ preventScroll: true });
}

/**
 * Verwijdert een item. Wordt zijn klik daardoor leeg, dan verdwijnt de hele klik; staat die
 * vóór de huidige positie, dan schuift de positie mee terug. Zonder animatie of geluid.
 */
function deleteItem(item) {
  const { i, s, k } = locate(item);
  const steps = flat[i].steps;
  steps[s].splice(k, 1);
  if (steps[s].length === 0) {
    steps.splice(s, 1);
    if (i === pos.sheet && s < pos.step) pos = { sheet: i, step: pos.step - 1 };
  }
  fresh.delete(item);
  dirtySheets.add(i);
  render(null);
}

/** Splitst de klik vóór dit item (on) of voegt zijn klik samen met de vorige (!on). Het beeld blijft gelijk. */
function setNewClick(item, on) {
  const { i, s, k } = locate(item);
  const steps = flat[i].steps;
  if (on && k > 0) {
    steps.splice(s + 1, 0, steps[s].splice(k));
    if (i === pos.sheet && s < pos.step) pos = { sheet: i, step: pos.step + 1 };
  } else if (!on && k === 0 && s > 0) {
    steps[s - 1].push(...steps.splice(s, 1)[0]);
    if (i === pos.sheet && s < pos.step) pos = { sheet: i, step: pos.step - 1 };
  }
  dirtySheets.add(i);
}

/* ---------- Toevoegen (?edit) ---------- */
// "Toevoegen" in de bedieningsbalk opent een menu met de soorten items. Het gekozen item komt
// achteraan de huidige klik (of, als er op dit vel nog niets geklikt is, in een nieuwe eerste
// klik) en het tekstvak gaat open. Met "nieuwe klik" maak je er een eigen klik van. Annuleren of
// leeg laten verwijdert het weer.

function openAddMenu() {
  if (!isContent(pos)) return;
  // Een klik heeft hooguit één vraag.
  const question = els.addMenu.querySelector('[data-type="question"]');
  question.disabled = questionItemAt(pos) !== null;
  question.title = question.disabled ? 'Deze klik heeft al een vraag' : '';
  els.addMenu.hidden = false;
  els.addBtn.setAttribute('aria-expanded', 'true');
  els.controls.classList.add('menu-open');
  els.addMenu.querySelector('button:not(:disabled)').focus();
}

function closeAddMenu() {
  els.addMenu.hidden = true;
  els.addBtn.setAttribute('aria-expanded', 'false');
  els.controls.classList.remove('menu-open');
}

function addItem(type) {
  closeAddMenu();
  if (!isContent(pos)) return;
  const item = { type, text: '' };
  const steps = flat[pos.sheet].steps;
  if (pos.step === 0) { steps.unshift([item]); pos = { sheet: pos.sheet, step: 1 }; }
  else steps[pos.step - 1].push(item);
  fresh.add(item);
  dirtySheets.add(pos.sheet);
  render(null);
  editItem(item);
}

if (editMode) {
  els.addBtn.hidden = false;
  els.addBtn.addEventListener('click', () => (els.addMenu.hidden ? openAddMenu() : closeAddMenu()));
  els.addMenu.addEventListener('click', (e) => {
    const choice = e.target.closest('[data-type]');
    if (choice && !choice.disabled) addItem(choice.dataset.type);
  });
  els.addMenu.addEventListener('keydown', (e) => {
    const items = [...els.addMenu.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeAddMenu(); els.addBtn.blur(); }
    else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
    else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
    else return;
    e.preventDefault();
    e.stopPropagation(); // niet ook door de presentatie laten bladeren
  });
  // Ergens anders klikken sluit het menu.
  document.addEventListener('click', (e) => {
    if (!els.addMenu.hidden && !els.addMenu.contains(e.target) && e.target !== els.addBtn) closeAddMenu();
  });

  document.documentElement.classList.add('edit-mode');
  $('#edit-badge').hidden = false;
  const onLine = (ul, itemsAt) => (e) => {
    const li = e.target.closest('li');
    const line = li && itemsAt(pos)[[...ul.children].indexOf(li)];
    if (line) editItem(line.ref);
  };
  els.tipsList.addEventListener('click', onLine(els.tipsList, tipsAt));
  els.keywordList.addEventListener('click', onLine(els.keywordList, keywordsAt));
  els.questionText.addEventListener('click', () => {
    const question = questionItemAt(pos);
    if (question) editItem(question);
  });
}

/* ---------- Geluid ---------- */
// Met Web Audio opgewekt, dus geen geluidsbestanden nodig. De AudioContext wordt pas
// bij het eerste geluid gemaakt: browsers staan geluid pas toe na een klik of toets.
// In de bewerkmodus (?edit) klinkt nooit iets.

let audio = null;

function getAudio() {
  audio ??= new AudioContext();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

// Het eerste aanmaken van een AudioContext kan honderden milliseconden duren (het besturings-
// systeem opent het geluidsapparaat). Daarom vooraf, bij het inloggen of de eerste toets of klik,
// en niet midden in een overgang. Browsers staan het pas toe na zo'n handeling van de gebruiker.
function warmUpAudio() {
  if (editMode || audio) return;
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
  if (editMode) return 0; // de bewerkmodus is stil
  const wait = Math.max(0, soundBusyUntil - performance.now());
  soundBusyUntil = performance.now() + wait + seconds * 1000 + SOUND_GAP;
  if (wait === 0) startSound(play, seconds);
  else soundTimers.push(setTimeout(() => startSound(play, seconds), wait));
  return wait;
}

/** Klein geluidje bij een beweging: alleen als het stil is, anders vervalt het. */
function playIfQuiet(play, seconds) {
  if (editMode || performance.now() < soundBusyUntil) return;
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
window.addEventListener('resize', () => { if (deck) fitStage(); });

document.addEventListener('keydown', (e) => {
  if (!deck || e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.('input, select, textarea')) return; // tijdens typen of kiezen niet navigeren
  if (!els.addMenu.hidden) return; // het toevoegmenu regelt zijn eigen toetsen
  if (e.key === ' ' && e.target === els.pdf) return; // spatie bedient de PDF-knop, niet "volgende"
  const nextKeys = ['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Spacebar'];
  const prevKeys = ['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'];
  if (nextKeys.includes(e.key)) { e.preventDefault(); next(); }
  else if (prevKeys.includes(e.key)) { e.preventDefault(); prev(); }
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (isStart(pos)) return; // op het startscherm werken alleen Start en volledig scherm
  else if (e.key === 'w' || e.key === 'W') toggleAgreements();
  else if (e.key === 'Escape' && !els.agreementsBox.hidden) toggleAgreements(false);
  // Home/End: eerste en laatste inhoud, niet het start- of afsluitscherm
  else if (e.key === 'Home') { e.preventDefault(); goTo(firstContent()); }
  else if (e.key === 'End') { e.preventDefault(); goTo(lastContent()); }
  // Plus (Shift+= of het numerieke toetsenblok): tip toevoegen. preventDefault voorkomt
  // dat de '+' zelf in het zojuist gefocuste tekstveld belandt.
  // In de bewerkmodus opent de plustoets het toevoegmenu in plaats van het tipformulier.
  else if (e.key === '+' && isContent(pos)) { e.preventDefault(); if (editMode) openAddMenu(); else openTipForm(); }
});

els.next.addEventListener('click', (e) => { e.currentTarget.blur(); next(); });
els.prev.addEventListener('click', (e) => { e.currentTarget.blur(); prev(); });
$('#btn-full').addEventListener('click', (e) => { e.currentTarget.blur(); toggleFullscreen(); });
els.agreementsBtn.addEventListener('click', (e) => { e.currentTarget.blur(); toggleAgreements(); });

/**
 * Werkafspraken tonen of verbergen (show weglaten = wisselen). Ze liggen als overlay over het
 * hele whiteboard en blijven staan tijdens het bladeren, tot je ze weer verbergt.
 */
function toggleAgreements(show = els.agreementsBox.hidden) {
  if (show && (!isContent(pos) || deck.agreements.length === 0)) return;
  const box = els.agreementsBox;
  if (box.getAnimations().length) finishAllAnimations(); // nog aan het in- of uitfaden: eerst afronden
  els.agreementsBtn.setAttribute('aria-pressed', String(show));
  if (show === !box.hidden) return;
  if (show) {
    box.hidden = false;
    animate(box, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
  } else {
    animate(box, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-in' }, () => { box.hidden = true; });
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

/* ---------- Wijzigingen downloaden ---------- */
// Op het afsluitscherm: wijkt de inhoud mét alle wijzigingen af van de geladen versie, dan
// staat daar groot een downloadlink (onversleutelde JSON).

let downloadUrl = null;

function updateDownload() {
  const link = els.download;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
  const updated = isEnd(pos) ? contentWithChanges() : null;
  const changed = updated !== null && JSON.stringify(updated) !== JSON.stringify(rawContent);
  els.endDownload.hidden = !changed;
  if (!changed) { link.removeAttribute('href'); return; }
  downloadUrl = URL.createObjectURL(
    new Blob([JSON.stringify(updated, null, 2) + '\n'], { type: 'application/json' })
  );
  link.href = downloadUrl;

  // Tellen: wat er nu in het model staat, vergeleken met de items zoals geladen.
  const now = new Set(flat.flatMap((f) => f.steps.flat()));
  const count = (n, what) => (n === 1 ? '1 onderdeel ' : n + ' onderdelen ') + what;
  const added = [...now].filter((it) => !original.has(it)).length;
  const edited = [...now].filter((it) => original.has(it) && JSON.stringify(it) !== original.get(it)).length;
  const removed = [...original.keys()].filter((it) => !now.has(it)).length;
  const parts = [];
  if (added) parts.push(count(added, 'toegevoegd'));
  if (edited) parts.push(count(edited, 'bewerkt'));
  if (removed) parts.push(count(removed, 'verwijderd'));
  const list = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' en ' + parts.at(-1) : parts[0] ?? 'de indeling in klikken gewijzigd';
  els.endNote.textContent = `Je hebt ${list}. `
    + 'Dit bestand is onversleuteld: zet het in de projectmap, versleutel het opnieuw en verwijder de download.';
}

/**
 * De geladen inhoud met alle wijzigingen. Werkt op een kopie van de originele JSON: alleen de
 * steps van gewijzigde vellen worden vervangen door die uit het model, al het andere (ook
 * velden die de motor niet kent) blijft precies zoals het was. Ongeldige items en steps in een
 * gewijzigd vel, die de motor al oversloeg, vallen daarbij weg.
 */
function contentWithChanges() {
  const copy = structuredClone(rawContent);
  for (const i of dirtySheets) {
    const f = flat[i];
    let topic = copy.topics[f.topic];
    if (!topic || typeof topic !== 'object') topic = copy.topics[f.topic] = { sticky: deck.topics[f.topic].sticky, sheets: [] };
    if (!Array.isArray(topic.sheets)) topic.sheets = [];
    let sheet = topic.sheets[f.sheet];
    if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) sheet = topic.sheets[f.sheet] = { title: f.title };
    sheet.steps = f.steps.map((step) => step.map((item) => structuredClone(item)));
  }
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
  const title = deck.title || 'Presentatie';
  // De paginatitel wordt de voorgestelde bestandsnaam van de PDF.
  titleBeforePrint = document.title;
  document.title = `${title} – vellen – ${date}`;
  document.documentElement.classList.add('print-sheets');

  const root = els.print;
  root.replaceChildren();
  const page = { title, date, iso: now.toISOString().slice(0, 10) };
  const filled = (items) => items.filter((it) => it.text.trim() !== ''); // net toegevoegd, nog leeg
  const pages = [];
  const tips = filled(tipsAt({ sheet: flat.length, step: 0 }));
  if (tips.length) pages.push(...printSheet(page, 'tips', 'Tips', tips, 'Alle tips uit de presentatie'));
  flat.forEach((f, i) => {
    const items = filled(keywordsAt({ sheet: i, step: f.steps.length }));
    pages.push(...printSheet(page, 'keywords', f.title, items, 'Onderwerp: ' + deck.topics[f.topic].sticky));
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
