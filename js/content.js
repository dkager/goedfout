// Inhoudsschema, gedeeld door de motor (app.js) en het versleutelscript (tools/encrypt.js),
// zodat beide precies dezelfde regels hanteren.
//
// Opbouw: topics[] → sheets[] → { title, steps[] }, en elke step is een lijst van items die bij
// één klik tegelijk verschijnen: [{ type, text, … }, …].

/**
 * Soorten items. Een nieuw type hier toevoegen, en de weergave in app.js
 * (keywordsAt/tipsAt/questionAt/checkedGoalsAt). "check" vinkt een doel af ({ type, goal }).
 */
export const ITEM_TYPES = new Set(['keyword', 'tip', 'question', 'check']);

/**
 * De vaste ids van de doelen, in volgorde en dus ook hun vak in de strook bovenaan het
 * whiteboard: linksboven, rechtsboven, linksonder, rechtsonder. Andere ids zijn ongeldig;
 * hoofdletters maken niet uit. Doelen staan altijd aaneengesloten: n doelen zijn doel1 t/m doeln.
 */
export const GOAL_IDS = ['doel1', 'doel2', 'doel3', 'doel4'];

/** Maximaal aantal doelen in de strook bovenaan het whiteboard. */
export const GOALS_MAX = GOAL_IDS.length;

/**
 * Maximale lengte van de tekst van een doel (tekens). Gemeten: vier doelen van deze lengte passen
 * nog in de strook met de kleinste letters (22px, op 1920×1080 zo’n 26px op het scherm); bij 110
 * tekens niet meer.
 */
export const GOAL_TEXT_MAX = 100;

/**
 * Maximaal aantal onderwerpen (geeltjes). Gemeten op 1920×1080: tot 6 onderwerpen passen er 2
 * geeltjes naast elkaar en zijn de letters 20–22px (op het scherm zo’n 24–26px); vanaf 7 worden
 * het er 3 per rij en de letters 12px of kleiner (zie stickySize in app.js). Meer is een probleem
 * (een waarschuwing), geen fout.
 */
export const TOPICS_MAX = 6;

/** Markerkleuren voor een keyword (`"color": ...`). Zonder kleur: blauw. Zie --marker-* in style.css. */
export const KEYWORD_COLORS = new Set(['blue', 'red', 'black', 'green', 'yellow', 'orange', 'purple', 'pink']);

/** Inspringniveaus voor een keyword (`"indent": ...`); zonder indent: 0. */
export const KEYWORD_INDENTS = [0, 1, 2];

/** Ruimte boven een keyword (`"gap": ...`); zonder gap: niets. */
export const KEYWORD_GAPS = new Set(['space', 'line']);

// Regeleinden: \n, \r\n, een losse \r, U+2028 en U+2029.
const LINE_BREAKS = new RegExp('\\r\\n?|[\\n\\u2028\\u2029]');

/**
 * Een vel, een titel of een item is altijd één regel: regeleinden (met de witruimte eromheen,
 * ook meerdere na elkaar) worden één spatie. Meldt het als dat nodig was. Lineair: geen regex
 * die op lange witruimte gaat backtracken.
 */
function oneLine(text, where, problems) {
  const parts = text.split(LINE_BREAKS);
  if (parts.length === 1) return text;
  problems.push(`${where}: regeleinde vervangen door een spatie.`);
  const last = parts.length - 1;
  return parts.map((part, i) => (i === 0 ? part.trimEnd() : i === last ? part.trimStart() : part.trim())).filter(Boolean).join(' ');
}

/**
 * Een doel vink je maar één keer af. Loopt de vellen in volgorde langs en haalt elk volgend
 * afvinkmoment van een doel weg (een klik die daardoor leeg wordt ook). seen: doel → titel van
 * het vel waar het al wordt afgevinkt (wordt aangevuld). Geeft de weggehaalde terug als
 * [{ goal, sheet, first }]. Gedeeld door normalizeContent en de bewerkmodus (app.js).
 */
export function dropRepeatedChecks(sheets, seen = new Map()) {
  const dropped = [];
  for (const sheet of sheets) {
    for (const step of sheet.steps) {
      for (let k = 0; k < step.length; k++) {
        const item = step[k];
        if (item.type !== 'check') continue;
        if (seen.has(item.goal)) {
          dropped.push({ goal: item.goal, sheet: sheet.title, first: seen.get(item.goal) });
          step.splice(k--, 1);
        } else {
          seen.set(item.goal, sheet.title);
        }
      }
    }
    for (let s = sheet.steps.length - 1; s >= 0; s--) if (sheet.steps[s].length === 0) sheet.steps.splice(s, 1);
  }
  return dropped;
}

/**
 * Controleert en normaliseert de inhoud. Ongeldige onderdelen worden overgeslagen en als
 * probleem gemeld. Ontbrekende verplichte velden (de titel van een vel) zijn fouten: de
 * presentatie toont ze nog wel, maar tools/encrypt.js weigert te versleutelen.
 * Gooit alleen een fout als er geen onderwerpen zijn.
 *
 * De items in het resultaat zijn dezelfde objecten als in raw (alleen gefilterd); de motor
 * geeft daarom een kopie van de geladen JSON mee, zodat het origineel onaangeroerd blijft.
 * @returns {{ content: object, problems: string[], errors: string[] }}
 */
export function normalizeContent(raw) {
  if (!raw || !Array.isArray(raw.topics) || raw.topics.length === 0) {
    throw new Error('De inhoud bevat geen onderwerpen ("topics").');
  }
  const problems = [];
  const errors = [];
  const emptySheet = () => ({ title: '', steps: [] });

  // Doelen: [{ id, text }], hooguit GOALS_MAX, met de ids doel1, doel2, … op volgorde (zie
  // GOAL_IDS). Streng: elke afwijking is een fout, zodat tools/encrypt.js weigert. De presentatie
  // toont wat wel klopt.
  const goals = [];
  if (raw.goals !== undefined && !Array.isArray(raw.goals)) errors.push('"goals" is geen lijst — geen doelen getoond.');
  (Array.isArray(raw.goals) ? raw.goals : []).forEach((goal, n) => {
    const at = `Doel ${n + 1}`;
    const want = GOAL_IDS[n];
    if (!want) {
      errors.push(`${at}: er zijn hooguit ${GOALS_MAX} doelen — overgeslagen.`);
    } else if (!goal || typeof goal !== 'object' || typeof goal.id !== 'string' || typeof goal.text !== 'string') {
      errors.push(`${at}: moet er zo uitzien: { "id": "${want}", "text": "…" } — overgeslagen.`);
    } else if (goal.id.trim().toLowerCase() !== want) {
      errors.push(`${at}: de id moet "${want}" zijn, niet "${goal.id}". De doelen heten doel1 t/m doel${GOALS_MAX}, op volgorde en zonder gaten — overgeslagen.`);
    } else if (!(goal.text = oneLine(goal.text, `${at} (${want})`, problems)).trim()) {
      errors.push(`${at} (${want}): de tekst is leeg — overgeslagen.`);
    } else {
      const text = goal.text.trim();
      if (text.length > GOAL_TEXT_MAX) errors.push(`${at} (${want}): de tekst is ${text.length} tekens; hooguit ${GOAL_TEXT_MAX}.`);
      goals.push({ id: want, text });
    }
  });
  const goalIds = new Set(goals.map((g) => g.id));

  if (raw.topics.length > TOPICS_MAX) problems.push(`Er zijn ${raw.topics.length} onderwerpen; boven de ${TOPICS_MAX} worden de geeltjes slecht leesbaar.`);
  const topics = raw.topics.map((t, ti) => {
    const where = `Onderwerp ${ti + 1}`;
    if (!t || typeof t !== 'object') {
      problems.push(`${where}: is geen object — wordt een leeg geeltje.`);
      return { sticky: '', sheets: [emptySheet()] };
    }
    if (typeof t.sticky !== 'string') problems.push(`${where}: "sticky" ontbreekt of is geen tekst.`);
    else t.sticky = oneLine(t.sticky, `${where} (geeltje)`, problems);

    let sheets = [];
    if (Array.isArray(t.sheets)) sheets = t.sheets;
    else problems.push(`${where}: "sheets" ontbreekt of is geen lijst — wordt één leeg vel.`);

    sheets = sheets.map((sheet, si) => {
      const at = `${where}, vel ${si + 1}`;
      if (!sheet || typeof sheet !== 'object' || Array.isArray(sheet)) {
        errors.push(`${at}: is geen vel. Een vel ziet er zo uit: { "title": "…", "steps": [ [ … ], … ] }.`);
        return emptySheet();
      }
      if (typeof sheet.title === 'string') sheet.title = oneLine(sheet.title, `${at} (titel)`, problems);
      if (typeof sheet.title !== 'string' || !sheet.title.trim()) errors.push(`${at}: "title" ontbreekt — elk vel moet een titel hebben.`);
      if (!Array.isArray(sheet.steps)) problems.push(`${at}: "steps" ontbreekt of is geen lijst — wordt een leeg vel.`);

      const steps = (Array.isArray(sheet.steps) ? sheet.steps : []).map((step, k) => {
        const atStep = `${at}, step ${k + 1}`;
        if (!Array.isArray(step)) {
          problems.push(`${atStep}: is geen lijst van items — overgeslagen. Een step ziet er zo uit: [ { "type": "keyword", "text": "…" } ].`);
          return null;
        }
        let hasQuestion = false;
        const items = step.filter((item, n) => {
          const atItem = `${atStep}, item ${n + 1}`;
          if (!item || !ITEM_TYPES.has(item.type)) {
            problems.push(`${atItem}: onbekend type "${item && item.type}" — overgeslagen.`);
            return false;
          }
          if (item.type === 'check') {
            // Streng (een fout), maar hoofdletterongevoelig: "DOEL1" wordt "doel1".
            const id = typeof item.goal === 'string' ? item.goal.trim().toLowerCase() : '';
            if (!goalIds.has(id)) {
              errors.push(`${atItem}: "goal" moet een bestaand doel zijn (${[...goalIds].join(', ') || 'er zijn geen doelen'}), niet "${item.goal}" — overgeslagen.`);
              return false;
            }
            item.goal = id;
            return true;
          }
          if (typeof item.text !== 'string') {
            problems.push(`${atItem}: "text" ontbreekt of is geen tekst — overgeslagen.`);
            return false;
          }
          item.text = oneLine(item.text, atItem, problems);
          if (item.type === 'question') {
            if (hasQuestion) {
              problems.push(`${atItem}: een step heeft hooguit één vraag — overgeslagen.`);
              return false;
            }
            hasQuestion = true;
          }
          // Het item zelf blijft ongewijzigd (de export neemt het zo over); de motor gebruikt
          // bij een ongeldige waarde gewoon de standaard.
          if (item.type === 'keyword') {
            if (item.color !== undefined && !KEYWORD_COLORS.has(item.color)) {
              problems.push(`${atItem}: onbekende kleur "${item.color}" — standaardkleur gebruikt. Kies uit: ${[...KEYWORD_COLORS].join(', ')}.`);
            }
            if (item.indent !== undefined && !KEYWORD_INDENTS.includes(item.indent)) {
              problems.push(`${atItem}: "indent" moet 0, 1 of 2 zijn — niet ingesprongen.`);
            }
            if (item.numbered !== undefined && typeof item.numbered !== 'boolean') {
              problems.push(`${atItem}: "numbered" moet true of false zijn — geen nummer.`);
            }
            if (item.gap !== undefined && !KEYWORD_GAPS.has(item.gap)) {
              problems.push(`${atItem}: "gap" moet "space" of "line" zijn — geen ruimte erboven.`);
            }
          }
          if (item.type === 'tip' && item.user !== undefined && typeof item.user !== 'boolean') {
            problems.push(`${atItem}: "user" moet true of false zijn.`);
          }
          return true;
        });
        if (items.length === 0) {
          problems.push(`${atStep}: bevat geen (geldige) items — overgeslagen.`);
          return null;
        }
        return items;
      }).filter(Boolean);

      // Boven het eerste steekwoord van een vel staat niets: daar kan geen ruimte of lijn boven.
      const first = steps.flat().find((it) => it.type === 'keyword');
      if (first && first.gap !== undefined) {
        errors.push(`${at}: het eerste steekwoord van een vel kan geen "gap" hebben (er staat niets boven) — genegeerd.`);
        delete first.gap;
      }
      return { title: typeof sheet.title === 'string' ? sheet.title : '', steps };
    });
    if (sheets.length === 0) sheets = [emptySheet()]; // een onderwerp heeft altijd minstens één (leeg) vel
    return { sticky: String(t.sticky ?? ''), sheets };
  });

  if (typeof raw.title === 'string') raw.title = oneLine(raw.title, 'De titel van de presentatie', problems);
  if (typeof raw.title !== 'string' || !raw.title.trim()) errors.push('"title" ontbreekt — de presentatie moet een titel hebben.');
  if (raw.agreements !== undefined && !Array.isArray(raw.agreements)) problems.push('"agreements" is geen lijst.');
  if (Array.isArray(raw.agreements)) raw.agreements = raw.agreements.map((a, n) => oneLine(String(a), `Werkafspraak ${n + 1}`, problems));

  // Een doel vink je maar één keer af (in de volgorde van de presentatie telt het eerste).
  for (const d of dropRepeatedChecks(topics.flatMap((t) => t.sheets))) {
    errors.push(`Vel „${d.sheet}”: ${d.goal} wordt al afgevinkt op „${d.first}”; een doel vink je maar één keer af — overgeslagen.`);
  }

  return {
    content: {
      title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'Presentatie',
      agreements: Array.isArray(raw.agreements) ? raw.agreements.map(String) : [],
      goals,
      topics,
    },
    problems,
    errors,
  };
}
