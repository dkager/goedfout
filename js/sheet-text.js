// De klikken van een vel als platte tekst, voor het tekstvak van de bewerkmodus (?edit), en weer
// terug. De titel van het vel hoort er niet bij: die bewerk je los, op het vel zelf.
// Zonder DOM, zodat het ook in Node te testen is.
//
// Notatie, één item per regel:
//   * tekst  - tekst   steekwoord met bullet (de bullet volgt uit het inspringen); ook • tekst
//   1. tekst           genummerd steekwoord (het getal zelf telt niet; de motor nummert)
//   2 spaties ervoor   1× inspringen; 4 of meer: 2× (een tab telt als 2 spaties)
//   [red] / [rood]     kleur van het steekwoord, waar dan ook op de regel. Het eerste kleurlabel
//                      telt; alle kleurlabels verdwijnen uit de tekst. Engels of Nederlands,
//                      hoofdletters maken niet uit.
//   (lege regel)       witruimte boven het volgende steekwoord
//   ---                lijn boven het volgende steekwoord
//   ->  -->  →         nieuwe klik
//   ? tekst            vraag op het whiteboard (een tweede vraag begint vanzelf een nieuwe klik)
//   ! tekst            tip op de linker flip-over
//   +id                vinkt het doel met die id af (hoofdletters maken niet uit)
// Elke andere regel wordt een steekwoord met bullet. Een regel met alleen codes en geen tekst
// (zoals "* [rood]" of "?") wordt overgeslagen. Ruimte en lijnen gelden alleen vóór een
// steekwoord (niet vóór een vraag, tip, doel of klik, en niet bovenaan het vel); meerdere
// lege regels, lijnen of klikken na elkaar tellen als één. Onzichtbare tekens aan het begin
// en eind van een regel (zero-width space, BOM, richtingstekens, …) tellen niet mee; U+2028,
// U+2029 en een losse \r zijn een nieuwe regel.

import { KEYWORD_COLORS } from './content.js';

const INDENT = ['', '  ', '    '];

// Kleurnamen in het tekstvak (kleine letters) → de kleur in de JSON. De Nederlandse namen werken
// bij het inlezen naast de Engelse; wegschrijven (stepsToText) en de uitleg gebruiken alleen Engels.
const DUTCH = { blue: 'blauw', red: 'rood', black: 'zwart', green: 'groen', yellow: 'geel', orange: 'oranje', purple: 'paars', pink: 'roze' };
const COLOR_NAMES = new Map([...KEYWORD_COLORS].flatMap((c) => [[c, c], [DUTCH[c], c]]));

// Onzichtbaar: zero-width tekens, BOM, zacht afbreekstreepje en tekens voor de schrijfrichting.
const INVISIBLE = '\\u200B-\\u200F\\u2060\\uFEFF\\u00AD\\u202A-\\u202E\\u2066-\\u2069';
const BLANK = new RegExp(`[\\s${INVISIBLE}]`);
const LEADING = new RegExp(`^[\\s${INVISIBLE}]*`);
// Regeleinden: \n, \r\n, een losse \r en de Unicode-regelscheidingen U+2028 en U+2029.
const LINE_BREAKS = new RegExp('\\r\\n?|[\\n\\u2028\\u2029]');

/** Een lijst teksten (zoals de werkafspraken) als tekst: één per regel. */
export function listToText(items) {
  return items.length ? items.join('\n') + '\n' : '';
}

/**
 * Leest een lijst terug: één tekst per regel. Een * - • of 1. aan het begin valt weg (zodat je
 * een lijstje kunt plakken), net als lege regels en regels met alleen codes.
 */
export function textToList(text) {
  const out = [];
  for (const raw of text.split(LINE_BREAKS)) {
    let line = clean(raw);
    const marker = /^(?:[*•-]|\d+\.(?=\s|$))\s*([^]*)$/.exec(line);
    if (marker) line = clean(marker[1]);
    if (hasText(line)) out.push(line);
  }
  return out;
}

/** De klikken (steps) van een vel als tekst. Genummerde steekwoorden krijgen hun echte nummer. */
export function stepsToText(steps) {
  const lines = [];
  steps.forEach((step, s) => {
    if (s > 0) lines.push('->');
    const count = [0, 0, 0];
    for (const item of step) {
      if (item.type === 'question') lines.push('? ' + item.text);
      else if (item.type === 'tip') lines.push('! ' + item.text);
      else if (item.type === 'check') lines.push('+' + item.goal);
      else if (item.type === 'keyword') {
        const level = [1, 2].includes(item.indent) ? item.indent : 0;
        if (item.gap === 'line') lines.push('---');
        else if (item.gap === 'space' && lines.length && lines.at(-1) !== '') lines.push('');
        // Nummers zoals de motor ze telt (renumber in app.js), maar per klik opnieuw: alleen
        // ter informatie, bij het inlezen telt het getal niet.
        for (let l = level + 1; l < count.length; l++) count[l] = 0;
        let marker;
        if (item.numbered === true) marker = ++count[level] + '.';
        else { count[level] = 0; marker = level === 0 ? '*' : '-'; }
        const color = KEYWORD_COLORS.has(item.color) ? ` [${item.color}]` : '';
        lines.push(INDENT[level] + marker + ' ' + item.text + color);
      }
    }
  });
  return lines.length ? lines.join('\n') + '\n' : '';
}

/**
 * Leest de tekst terug als klikken (steps). goalIds: de ids die met +id afgevinkt kunnen worden;
 * een onbekende id wordt een gewoon steekwoord. Het resultaat kan leeg zijn ([]).
 */
export function textToSteps(text, goalIds) {
  const goals = new Map([...goalIds].map((id) => [id.toLowerCase(), id]));
  const lines = text.split(LINE_BREAKS);

  const steps = [[]];
  let gap = null;          // ruimte die wacht op het volgende steekwoord
  let anyKeyword = false;  // bovenaan het vel geen ruimte
  const step = () => steps[steps.length - 1];
  const newStep = () => { if (step().length) steps.push([]); };

  for (const raw of lines) {
    const content = clean(raw);
    if (content === '') { gap = gap ?? 'space'; continue; }
    if (/^-{3,}$/.test(content)) { gap = 'line'; continue; }
    if (/^(?:-{1,2}>|→)$/.test(content)) { newStep(); gap = null; continue; }

    // Inspringen: tabs tellen als 2 spaties; onzichtbare tekens tellen niet.
    const lead = LEADING.exec(raw)[0].replace(new RegExp(`[${INVISIBLE}]`, 'g'), '');
    const spaces = lead.replace(/\t/g, '  ').length;
    const indent = spaces >= 4 ? 2 : spaces >= 2 ? 1 : 0;

    const { text, color } = takeColors(content);
    if (!hasText(text)) continue; // alleen codes (zoals "* [rood]" of "?"): overslaan

    const question = /^\?\s*([^]*)$/.exec(text);
    if (question) {
      if (!hasText(question[1])) continue;
      if (step().some((it) => it.type === 'question')) newStep(); // twee vragen: impliciete klik
      step().push({ type: 'question', text: clean(question[1]) });
      gap = null;
      continue;
    }
    const tip = /^!\s*([^]*)$/.exec(text);
    if (tip) {
      if (!hasText(tip[1])) continue;
      step().push({ type: 'tip', text: clean(tip[1]) });
      gap = null;
      continue;
    }
    const goalMatch = /^\+(\S+)$/.exec(text);
    const goal = goalMatch && goals.get(goalMatch[1].toLowerCase());
    if (goal) {
      step().push({ type: 'check', goal }); // een doel twee keer afvinken: zie dropRepeatedChecks in content.js
      gap = null;
      continue;
    }

    // Steekwoord: met *, -, •, een nummer, of (alles wat hierboven niet paste) zonder teken.
    let words = text;
    let numbered = false;
    const marker = /^(?:[*•-]|(\d+)\.(?=\s|$))\s*([^]*)$/.exec(text);
    if (marker && (marker[1] === undefined || Number(marker[1]) >= 1)) {
      if (!hasText(marker[2])) continue;
      numbered = marker[1] !== undefined;
      words = clean(marker[2]);
    }
    const item = { type: 'keyword', text: words };
    if (color) item.color = color;
    if (indent) item.indent = indent;
    if (numbered) item.numbered = true;
    if (gap && anyKeyword) item.gap = gap;
    step().push(item);
    anyKeyword = true;
    gap = null;
  }

  if (!step().length) steps.pop();
  return steps;
}

/** De regel zonder witruimte en onzichtbare tekens aan begin en eind (lineair, ook bij lange witruimte). */
function clean(line) {
  let a = 0;
  let b = line.length;
  while (a < b && BLANK.test(line[a])) a++;
  while (b > a && BLANK.test(line[b - 1])) b--;
  return line.slice(a, b);
}

/** Staat er nog echte tekst, of alleen codes (* - • ? ! + 1.), witruimte en onzichtbare tekens? */
const hasText = (text) => clean(text.replace(/\d+\.|[*•?!+-]/g, '').replace(INVISIBLE_ALL, '')) !== '';
const INVISIBLE_ALL = new RegExp(`[${INVISIBLE}]`, 'g');

/**
 * Haalt alle geldige kleurlabels uit de tekst; het eerste bepaalt de kleur. De stukken ertussen
 * worden (zonder witruimte en onzichtbare tekens aan hun randen) met één spatie aan elkaar gezet.
 */
function takeColors(text) {
  let color = null;
  const pieces = [];
  let from = 0;
  for (const m of text.matchAll(/\[(\p{L}+)\]/gu)) {
    const name = COLOR_NAMES.get(m[1].toLowerCase());
    if (!name) continue;
    color = color ?? name;
    pieces.push(text.slice(from, m.index));
    from = m.index + m[0].length;
  }
  if (!color) return { text, color: null };
  pieces.push(text.slice(from));
  return { text: pieces.map(clean).filter(Boolean).join(' '), color };
}
