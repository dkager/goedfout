#!/usr/bin/env node
// Versleutelt content.json naar content.enc.json.
//
// Gebruik:
//   node tools/encrypt.js                       (vraagt om het wachtwoord)
//   node tools/encrypt.js invoer.json uitvoer.json
//   PRESENTATIE_WACHTWOORD=... node tools/encrypt.js   (bijv. in CI)
//   node tools/encrypt.js --decrypt content.enc.json   (controle: toont de inhoud)

import { readFile, writeFile } from 'node:fs/promises';
import { encryptText, decryptText } from '../js/crypto-core.js';
import { normalizeContent } from '../js/content.js';

/** Vraagt om invoer zonder die op het scherm te tonen. */
async function askHidden(question) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    const answer = await readPipedLine();
    process.stdout.write('\n');
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
          process.stdout.write('\n');
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
      process.stdout.write('\n');
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
    console.log(await decryptText(payload, pw));
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
  if (check.errors.length) {
    for (const e of check.errors) console.error('Fout: ' + e);
    console.error(`${input} is niet versleuteld: los eerst de fouten hierboven op.`);
    process.exit(1);
  }

  const pw = await getPassword(true);
  if (pw.length < 16) console.warn('Let op: gebruik bij voorkeur een wachtwoord van 16 tekens of meer.');

  // Compacte JSON scheelt bytes; de inhoud blijft identiek.
  const payload = await encryptText(JSON.stringify(content), pw);

  // Controle: kan het resultaat weer ontsleuteld worden?
  const roundtrip = await decryptText(payload, pw);
  if (roundtrip !== JSON.stringify(content)) throw new Error('Controle mislukt: ontsleutelde inhoud wijkt af');

  await writeFile(output, JSON.stringify(payload, null, 2) + '\n');
  console.log(`Klaar: ${input} → ${output} (gecontroleerd)`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
