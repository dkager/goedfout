// Zip-bestanden maken (zipFiles) en lezen (readZip, unzipEntry), zonder bibliotheken: alleen
// CompressionStream/DecompressionStream van de browser (en van Node.js). De export op het
// afsluitscherm gebruikt zipFiles; het uitpakken staat klaar voor later.

const LOCAL_HEADER = 0x04034b50, CENTRAL_HEADER = 0x02014b50, END_OF_CENTRAL = 0x06054b50;
const VERSION = 20, ENCRYPTED = 0x0001, UTF8_NAMES = 0x0800, STORED = 0, DEFLATED = 8;

export class ZipError extends Error {}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function joinBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function fail(why) {
  throw new ZipError(why);
}

export function isZip(bytes) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
}

function findEnd(view) {
  const last = view.byteLength - 22;
  for (let i = last; i >= Math.max(0, last - 0xffff); i--) {
    if (view.getUint32(i, true) === END_OF_CENTRAL && i + 22 + view.getUint16(i + 20, true) === view.byteLength) {
      for (let j = i + 22; j <= last; j++) {
        if (view.getUint32(j, true) === END_OF_CENTRAL) {
          fail('het commentaar bevat een tweede inhoudsopgave');
        }
      }
      return i;
    }
  }
  return fail('de inhoudsopgave ontbreekt');
}

function checkName(name, names) {
  if (!name || /[\p{Cc}\p{Cf}]/u.test(name) || /^([\\/]|[A-Za-z]:)/.test(name) || name.split(/[\\/]/).includes('..')) {
    fail('een bestandsnaam is verdacht');
  }
  const key = name.toLowerCase();
  if (names.has(key)) {
    fail('een bestandsnaam komt twee keer voor');
  }
  names.add(key);
}

function sameBytes(a, b) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

export function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at) => view.getUint16(at, true), u32 = (at) => view.getUint32(at, true);
  const end = findEnd(view);
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count) {
    fail('het bestand bestaat uit meerdere delen');
  }
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) {
    fail('het ZIP64-formaat wordt niet ondersteund');
  }
  if (start + size !== end) {
    fail('de inhoudsopgave klopt niet');
  }
  const entries = [], names = new Set();
  for (let at = start, k = 0; k < count; k++) {
    if (at + 46 > end || u32(at) !== CENTRAL_HEADER) {
      fail('de inhoudsopgave klopt niet');
    }
    const flags = u16(at + 8), compressedSize = u32(at + 20), nameLength = u16(at + 28), offset = u32(at + 42);
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    const name = new TextDecoder(flags & UTF8_NAMES ? 'utf-8' : 'windows-1252').decode(nameBytes);
    const entry = {
      name, nameBytes, utf8: flags & UTF8_NAMES, method: u16(at + 10), time: u16(at + 12), date: u16(at + 14),
      crc: u32(at + 16), size: u32(at + 24),
    };
    at += 46 + nameLength + u16(at + 30) + u16(at + 32);
    if (at > end) {
      fail('de inhoudsopgave klopt niet');
    }
    if (flags & ENCRYPTED) {
      fail('een bestand is versleuteld');
    }
    checkName(name, names);
    if (offset + 30 > start || u32(offset) !== LOCAL_HEADER || !sameBytes(bytes.subarray(offset + 30, offset + 30 + u16(offset + 26)), nameBytes)) {
      fail('een bestand klopt niet met de inhoudsopgave');
    }
    const dataStart = offset + 30 + nameLength + u16(offset + 28);
    if (dataStart + compressedSize > start) {
      fail('een bestand klopt niet met de inhoudsopgave');
    }
    const dataEnd = dataStart + compressedSize;
    entries.push({ ...entry, offset, dataEnd, compressed: bytes.subarray(dataStart, dataEnd) });
  }
  const sorted = [...entries].sort((a, b) => a.offset - b.offset);
  if (sorted.some((e, k) => k > 0 && sorted[k - 1].dataEnd > e.offset)) {
    fail('bestanden overlappen elkaar');
  }
  return entries;
}

async function inflate(entry, keep) {
  const reader = new Blob([entry.compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return joinBytes(chunks);
      }
      chunks.push(value);
      total += value.length;
      if (total > entry.size) {
        fail('een bestand is groter dan opgegeven');
      }
      if (total >= keep) {
        reader.cancel();
        return joinBytes(chunks).subarray(0, keep);
      }
    }
  } catch (e) {
    if (e instanceof ZipError) {
      throw e;
    }
    return fail('een bestand kan niet worden uitgepakt');
  }
}

export async function unzipEntry(entry, limit, keep = Infinity) {
  if (entry.size > limit) {
    fail(`een bestand is groter dan ${limit / 1e6} MB`);
  }
  let data;
  if (entry.method === STORED) {
    data = entry.compressed.subarray(0, keep);
  } else if (entry.method === DEFLATED) {
    data = await inflate(entry, keep);
  } else {
    fail('een bestand gebruikt een onbekende compressiemethode');
  }
  if (keep >= entry.size && (data.length !== entry.size || crc32(data) !== entry.crc)) {
    fail('een bestand is beschadigd');
  }
  return data;
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function newEntry({ name, bytes }, date) {
  const deflated = await deflate(bytes);
  const method = deflated.length < bytes.length ? DEFLATED : STORED;
  return {
    nameBytes: new TextEncoder().encode(name), utf8: UTF8_NAMES, method, crc: crc32(bytes), size: bytes.length,
    compressed: method === DEFLATED ? deflated : bytes,
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function header(size, fields) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const [width, value] of fields) {
    if (width === 4) {
      view.setUint32(at, value, true);
    } else {
      view.setUint16(at, value, true);
    }
    at += width;
  }
  return bytes;
}

function fileFields(e) {
  return [[2, VERSION], [2, e.utf8], [2, e.method], [2, e.time], [2, e.date], [4, e.crc], [4, e.compressed.length],
    [4, e.size], [2, e.nameBytes.length], [2, 0]];
}

export async function zipFiles(files) {
  const date = new Date();
  const entries = await Promise.all(files.map((f) => (f.compressed ? f : newEntry(f, date))));
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const local = header(30, [[4, LOCAL_HEADER], ...fileFields(e)]);
    central.push(header(46, [[4, CENTRAL_HEADER], [2, VERSION], ...fileFields(e), [2, 0], [2, 0], [2, 0], [4, 0], [4, offset]]),
      e.nameBytes);
    parts.push(local, e.nameBytes, e.compressed);
    offset += local.length + e.nameBytes.length + e.compressed.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = header(22, [[4, END_OF_CENTRAL], [2, 0], [2, 0], [2, entries.length], [2, entries.length], [4, centralSize],
    [4, offset], [2, 0]]);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
