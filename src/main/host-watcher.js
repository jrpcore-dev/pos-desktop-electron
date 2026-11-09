// Caja · si el Host deja de contestar, puede haber cambiado de IP: lo busca en la
// red y sigue trabajando con la dirección nueva, sin volver a emparejar. Cada
// intento fallido espera más que el anterior para no llenar la red de búsquedas.
const CHECK_EVERY_MS = 15000;
const FIRST_RETRY_MS = 30000;
const MAX_RETRY_MS = 5 * 60 * 1000;

const createHostWatcher = ({ isHostOk, relocate, onMoved, now = Date.now } = {}) => {
  let misses = 0;
  let nextAt = 0;
  let running = false;

  const tick = async () => {
    if (running) return null;
    if (isHostOk()) {
      misses = 0;
      nextAt = 0;
      return null;
    }
    if (now() < nextAt) return null;
    running = true;
    let result = null;
    try {
      result = await relocate();
    } catch (err) {
      result = null;
    } finally {
      running = false;
    }
    if (result && result.moved) {
      misses = 0;
      nextAt = 0;
      if (onMoved) onMoved(result);
      return result;
    }
    nextAt = now() + Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** misses);
    misses += 1;
    return result;
  };

  return { tick };
};

const startHostWatcher = (options) => {
  const watcher = createHostWatcher(options);
  const timer = setInterval(() => watcher.tick().catch(() => {}), options.intervalMs || CHECK_EVERY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
};

module.exports = { createHostWatcher, startHostWatcher, CHECK_EVERY_MS, FIRST_RETRY_MS, MAX_RETRY_MS };
