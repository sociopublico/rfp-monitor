/**
 * Las 15 palabras de peso de los textos nuevos.
 * El peso es en cuántos RFPs de la semana aparece la palabra,
 * no cuántas veces se repite en una sola página.
 */

const STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'lo', 'al', 'del',
  'de', 'a', 'en', 'y', 'o', 'u', 'e', 'que', 'es', 'son', 'ser', 'se', 'su',
  'sus', 'por', 'para', 'con', 'como', 'mas', 'pero', 'si', 'no', 'ya', 'muy',
  'tambien', 'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas',
  'esto', 'eso', 'aquel', 'aquella', 'entre', 'sobre', 'desde', 'hasta',
  'cuando', 'donde', 'porque', 'hay', 'han', 'ha', 'fue', 'fueron', 'era',
  'eran', 'estan', 'tiene', 'tienen', 'todo', 'toda', 'todos', 'todas',
  'otro', 'otra', 'otros', 'otras', 'cada', 'mismo', 'misma', 'sin', 'ni',
  'le', 'les', 'nos', 'mi', 'tu', 'yo', 'vos', 'usted', 'ustedes', 'ellos',
  'ellas', 'ella', 'ello', 'nosotros', 'vosotros', 'nuestro', 'nuestra', 'hacia', 'tras',
  'durante', 'mediante', 'segun', 'aunque', 'mientras', 'cuyo', 'cuya', 'asi',
  'bien', 'poco', 'mucho', 'muchos', 'muchas', 'tan', 'tanto', 'tanta',
  'aqui', 'alli', 'ahi', 'ahora', 'despues', 'antes', 'luego', 'solo',
  'puede', 'pueden', 'sido', 'siendo', 'hacer', 'hace', 'hacen', 'ver',
  'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'for', 'with',
  'as', 'at', 'by', 'from', 'into', 'over', 'after', 'before', 'between',
  'about', 'than', 'then', 'so', 'not', 'nor', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
  'would', 'can', 'could', 'should', 'may', 'might', 'this', 'that', 'these',
  'those', 'it', 'its', 'we', 'you', 'they', 'he', 'she', 'them', 'our',
  'your', 'their', 'his', 'her', 'who', 'what', 'which', 'when', 'where',
  'why', 'how', 'all', 'any', 'some', 'such', 'only', 'just', 'also', 'more',
  'most', 'other', 'out', 'up', 'down', 'new', 'via', 'per',
  'www', 'http', 'https', 'com', 'org', 'html', 'pdf'
].map(fold));

function fold(word) {
  return String(word || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function tokenize(text) {
  return String(text || '').match(/\p{L}[\p{L}'’-]*/gu) || [];
}

function tokensFromKeywords(keywords) {
  const tokens = [];
  for (const keyword of keywords || []) {
    for (const token of tokenize(keyword)) {
      const key = fold(token);
      if (key.length >= 3) {
        tokens.push(key);
      }
    }
  }
  return tokens;
}

/**
 * @param {string[]} texts Un texto por RFP nuevo
 * @param {{ limit?: number, extraStopwords?: string[] }} [options]
 * @returns {{ palabra: string, peso: number }[]}
 */
function rankWeekWords(texts, options = {}) {
  const limit = options.limit || 15;
  const banned = new Set(STOPWORDS);
  for (const word of options.extraStopwords || []) {
    const key = fold(word);
    if (key) {
      banned.add(key);
    }
  }

  const counts = new Map();

  for (const text of texts || []) {
    const seen = new Set();
    for (const token of tokenize(text)) {
      const key = fold(token);
      if (key.length < 3 || banned.has(key) || /^\d+$/.test(key)) {
        continue;
      }
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const current = counts.get(key) || { palabra: token.toLowerCase(), peso: 0 };
      if (current.palabra === key && token.toLowerCase() !== key) {
        current.palabra = token.toLowerCase();
      }
      current.peso += 1;
      counts.set(key, current);
    }
  }

  return [...counts.values()]
    .sort((a, b) => b.peso - a.peso || a.palabra.localeCompare(b.palabra, 'es'))
    .slice(0, limit)
    .map(({ palabra, peso }) => ({ palabra, peso }));
}

module.exports = {
  rankWeekWords,
  tokensFromKeywords,
  fold
};
