/**
 * Fecha de publicación dicha en el texto, no el día en que la vimos.
 * Ignora deadlines futuros y fechas de más de 18 meses. Si hay varias,
 * se queda con la más reciente que ya pasó o es hoy.
 */

const MONTH_INDEX = {
  january: 1, jan: 1, febrero: 2, february: 2, feb: 2,
  marzo: 3, march: 3, mar: 3, abril: 4, april: 4, apr: 4,
  mayo: 5, may: 5, junio: 6, june: 6, jun: 6,
  julio: 7, july: 7, jul: 7, agosto: 8, august: 8, aug: 8,
  septiembre: 9, setiembre: 9, september: 9, sep: 9, sept: 9,
  octubre: 10, october: 10, oct: 10,
  noviembre: 11, november: 11, nov: 11,
  diciembre: 12, december: 12, dec: 12,
  enero: 1, ene: 1
};

function extractPublicationDate(text, now = new Date()) {
  if (!text || typeof text !== 'string') {
    return null;
  }

  const found = new Set();

  function consider(year, month, day) {
    const iso = calendarDate(year, month, day);
    if (iso) {
      found.add(iso);
    }
  }

  let match;
  const isoPattern = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((match = isoPattern.exec(text)) !== null) {
    consider(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10));
  }

  const dmyPattern = /\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})\b/g;
  while ((match = dmyPattern.exec(text)) !== null) {
    consider(parseInt(match[3], 10), parseInt(match[2], 10), parseInt(match[1], 10));
  }

  const spanishPattern = /\b(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+(?:de\s+)?(\d{4})\b/gi;
  while ((match = spanishPattern.exec(text)) !== null) {
    const month = MONTH_INDEX[foldMonth(match[2])];
    if (month) {
      consider(parseInt(match[3], 10), month, parseInt(match[1], 10));
    }
  }

  const englishPattern = /\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi;
  while ((match = englishPattern.exec(text)) !== null) {
    const month = MONTH_INDEX[foldMonth(match[1])];
    if (month) {
      consider(parseInt(match[3], 10), month, parseInt(match[2], 10));
    }
  }

  const dayMonthPattern = /\b(\d{1,2})\s+([a-záéíóúñ]+)\s+(\d{4})\b/gi;
  while ((match = dayMonthPattern.exec(text)) !== null) {
    const month = MONTH_INDEX[foldMonth(match[2])];
    if (month) {
      consider(parseInt(match[3], 10), month, parseInt(match[1], 10));
    }
  }

  const today = dateInArgentina(now);
  const oldest = shiftMonths(today, -18);
  const usable = [...found].filter((iso) => iso <= today && iso >= oldest);
  if (usable.length === 0) {
    return null;
  }
  usable.sort();
  return usable[usable.length - 1];
}

function foldMonth(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function calendarDate(year, month, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function dateInArgentina(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function shiftMonths(isoDate, months) {
  const [year, month, day] = isoDate.split('-').map((part) => parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1 + months, day));
  return shifted.toISOString().slice(0, 10);
}

module.exports = { extractPublicationDate };
