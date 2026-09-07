/**
 * Clasifica el status visible de una URL (Sheet + API + home).
 * "Primera ejecución" solo aplica si no hubo un scrape exitoso anterior
 * con textHash. Un error reciente no borra el baseline ni el status del Sheet.
 */

function pickDisplayEvent(latest, lastSuccess) {
  if (latest && latest.status === 'success') {
    return latest;
  }
  if (lastSuccess) {
    return lastSuccess;
  }
  return latest;
}

function classifyUrlStatus(event, options = {}) {
  if (!event || event.status !== 'success') {
    return 'error';
  }

  const hadPriorBaseline = Boolean(options.hadPriorBaseline);
  const treatAsFirstRun = Boolean(event.isFirstRun) && !hadPriorBaseline;
  const textLength = event.textLength || 0;
  const changeRatio = event.changeRatio || 0;
  const changedChars = event.changedChars !== undefined
    ? event.changedChars
    : Math.round(textLength * changeRatio);
  const finalScore = event.finalScore || 0;
  const keywordsInChanges = event.keywordsInChanges || [];

  if (treatAsFirstRun) {
    if (keywordsInChanges.length >= 2) {
      return 'primera ejecución - relevante';
    }
    if (keywordsInChanges.length === 1) {
      return 'primera ejecución - posible';
    }
    return 'primera ejecución';
  }

  if (!event.hasChanged || changedChars === 0) {
    return 'sin cambios';
  }

  if (keywordsInChanges.length >= 2 || finalScore >= 70) {
    return 'cambios relevantes';
  }
  if (keywordsInChanges.length === 1 || finalScore >= 50) {
    return 'cambios - posiblemente relevante';
  }
  if (changeRatio >= 0.05) {
    return 'cambios - revisar';
  }
  return 'cambios irrelevantes';
}

function parseJsonl(content) {
  if (!content || typeof content !== 'string') {
    return [];
  }
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function lastBaselineEventForUrl(events, url) {
  if (!Array.isArray(events) || !url) {
    return null;
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event && event.url === url && event.textHash) {
      return event;
    }
  }
  return null;
}

function countBaselinesForUrl(events, url) {
  if (!Array.isArray(events) || !url) {
    return 0;
  }
  let count = 0;
  for (const event of events) {
    if (event && event.url === url && event.textHash) {
      count += 1;
    }
  }
  return count;
}

module.exports = {
  classifyUrlStatus,
  pickDisplayEvent,
  parseJsonl,
  lastBaselineEventForUrl,
  countBaselinesForUrl
};
