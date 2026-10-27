#!/usr/bin/env node
// Versleutelt content.json naar content.enc.json, en elke afbeelding die de inhoud gebruikt
// (img/naam.png of .jpg) naar img/naam.enc.png of .enc.jpg, met dezelfde sleutel.
//
// Gebruik:
//   node tools/encrypt.js                       (vraagt om het wachtwoord)
//   node tools/encrypt.js invoer.json uitvoer.json
//   PRESENTATIE_WACHTWOORD=... node tools/encrypt.js   (bijv. in CI)
//   node tools/encrypt.js --decrypt content.enc.json   (toont de inhoud, en zet de afbeeldingen
//                                                       onversleuteld terug in img/)

import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { newKey, payloadKey, encryptTextWith, decryptTextWith, encryptBytes, decryptBytes } from '../js/crypto-core.js';
import { normalizeContent } from '../js/content.js';

/**
 * Vraagt om invoer zonder die op het scherm te tonen. De vraag gaat naar stderr, zodat
 * --decrypt > content.json alleen de inhoud schrijft.
 */
async function askHidden(question) {
  process.stderr.write(question);
  if (!process.stdin.isTTY) {
    const answer = await readPipedLine();
    process.stderr.write('\n');
    return answer;
  }
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let answer = '';
    const onData = (chunk) => {
      if (chunk.startsWith('\x1b')) return; // pijltjestoetsen e.d. negeren
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\x03') { // Ctrl+C
          stdin.setRawMode(false);
          process.stderr.write('\n');
          process.exit(130);
        }
        if (ch === '\x7f' || ch === '\b') answer = [...answer].slice(0, -1).join('');
        else if (ch >= ' ') answer += ch;
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write('\n');
      resolve(answer);
    };
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}

// Invoer via een pipe (geen terminal): alles één keer inlezen en per regel uitdelen.
let pipedLines = null;
async function readPipedLine() {
  if (!pipedLines) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    pipedLines = text.split(/\r?\n/);
  }
  return pipedLines.shift() ?? '';
}

async function getPassword(confirm) {
  if (process.env.PRESENTATIE_WACHTWOORD) return process.env.PRESENTATIE_WACHTWOORD;
  const pw = await askHidden('Wachtwoord: ');
  if (confirm) {
    const again = await askHidden('Herhaal wachtwoord: ');
    if (pw !== again) {
      console.error('De wachtwoorden komen niet overeen.');
      process.exit(1);
    }
  }
  return pw;
}

async function main() {
  const args = process.argv.slice(2);

  if (args[0] === '--decrypt') {
    const file = args[1] || 'content.enc.json';
    const payload = JSON.parse(await readFile(file, 'utf8'));
    const pw = await getPassword(false);
    const key = await payloadKey(payload, pw);
    const text = await decryptTextWith(payload, key);
    // De afbeeldingen onversleuteld terug (img/naam.png of .jpg), zodat je opnieuw kunt versleutelen.
    const imgDir = join(dirname(file), 'img');
    const files = new Set(await readdir(imgDir).catch(() => []));
    for (const name of pinnedImages(JSON.parse(text))) {
      const ext = ['png', 'jpg'].find((e) => files.has(`${name}.enc.${e}`));
      if (!ext) { console.error(`Let op: afbeelding niet gevonden: ${join(imgDir, name)}.enc.png of .enc.jpg`); continue; }
      await writeFile(join(imgDir, `${name}.${ext}`), await decryptBytes(await readFile(join(imgDir, `${name}.enc.${ext}`)), key));
      console.error(`Ontsleuteld: ${join(imgDir, name)}.${ext}`);
    }
    console.log(text);
    return;
  }

  const input = args[0] || 'content.json';
  const output = args[1] || 'content.enc.json';
  const text = await readFile(input, 'utf8');

  let content;
  try {
    content = JSON.parse(text);
  } catch (e) {
    console.error(`${input} is geen geldige JSON: ${e.message}`);
    process.exit(1);
  }
  // Dezelfde controle als de motor: wat hier gemeld wordt, slaat de presentatie over.
  let check;
  try {
    check = normalizeContent(content);
  } catch (e) {
    console.error(`${input}: ${e.message}`);
    process.exit(1);
  }
  for (const p of check.problems) console.warn('Let op: ' + p);
  // Elke afbeelding moet bestaan: img/<naam>.png of .jpg naast het invoerbestand, met precies die
  // schrijfwijze (GitHub Pages onderscheidt hoofdletters, Windows en macOS meestal niet).
  const imgDir = join(dirname(input), 'img');
  const imgFiles = new Set(await readdir(imgDir).catch(() => []));
  const images = [];
  for (const name of pinnedImages(check.content)) {
    const ext = ['png', 'jpg'].find((e) => imgFiles.has(`${name}.${e}`));
    if (ext) images.push({ name, ext });
    else check.errors.push(`afbeelding niet gevonden: ${join(imgDir, name)}.png of .jpg (kleine letters).`);
  }
  if (check.errors.length) {
    for (const e of check.errors) console.error('Fout: ' + e);
    console.error(`${input} is niet versleuteld: los eerst de fouten hierboven op.`);
    process.exit(1);
  }

  const pw = await getPassword(true);
  if (pw.length < 16) console.warn('Let op: gebruik bij voorkeur een wachtwoord van 16 tekens of meer.');

  // Compacte JSON scheelt bytes. Dit is de inhoud zoals normalizeContent hem heeft opgeschoond
  // (regeleinden worden spaties, doel-ids in kleine letters); content.json zelf blijft ongewijzigd.
  // Eén sleutel voor de inhoud en de afbeeldingen (zie crypto-core.js).
  const k = await newKey(pw);
  const payload = await encryptTextWith(JSON.stringify(content), k);

  // Controle: kan het resultaat weer ontsleuteld worden, met het wachtwoord zoals bij het inloggen?
  const checkKey = await payloadKey(payload, pw);
  const roundtrip = await decryptTextWith(payload, checkKey);
  if (roundtrip !== JSON.stringify(content)) throw new Error('Controle mislukt: ontsleutelde inhoud wijkt af');
  const encrypted = [];
  for (const { name, ext } of images) {
    const bytes = await readFile(join(imgDir, `${name}.${ext}`));
    const enc = await encryptBytes(bytes, k.key);
    if (!Buffer.from(await decryptBytes(enc, checkKey)).equals(bytes)) throw new Error(`Controle mislukt: afbeelding ${name} wijkt af`);
    encrypted.push({ path: join(dirname(output), 'img', `${name}.enc.${ext}`), enc });
  }

  await writeFile(output, JSON.stringify(payload, null, 2) + '\n');
  if (encrypted.length) await mkdir(join(dirname(output), 'img'), { recursive: true });
  for (const { path, enc } of encrypted) await writeFile(path, enc);
  console.log(`Klaar: ${input} → ${output}${encrypted.length ? ` en ${encrypted.length} afbeelding(en) in ${join(dirname(output), 'img')}` : ''} (gecontroleerd)`);
}

/** De namen van alle afbeeldingen die de inhoud ophangt (elk één keer). */
function pinnedImages(content) {
  const items = (content.topics ?? []).flatMap((t) => (t.sheets ?? []).flatMap((s) => (s.steps ?? []).flat()));
  return [...new Set(items.filter((it) => it?.type === 'pin').map((it) => it.image))];
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
