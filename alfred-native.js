// Alfred Native Messaging adapter for the existing Companion MV3 background.
// Imported by upstream background.js via importScripts("alfred-native.js").
// Separate from Companion's popup port. No generic browser/script commands.
(() => {
  const api = globalThis.chrome;
  const HOST = "org.alfred.music_companion";
  const RETRY = "alfred-native-reconnect";
  const VALID = new Set([
    "status", "pause", "resume", "next", "previous", "shuffle", "repeat",
    "seek", "volume", "queue", "queue_play", "search", "select"
  ]);
  const MAX_REPLY = 32768;
  let port = null;

  const failure = (id, error) => ({ type: "alfred.response", id, ok: false, error });
  function plain(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function validRequest(m) {
    if (!plain(m) || m.type !== "alfred.request" ||
        !Number.isSafeInteger(m.id) || m.id < 1 || m.id > 1000000000 ||
        !VALID.has(m.command) || !plain(m.args) || Object.keys(m.args).length > 5)
      return false;
    const a = m.args;
    const noArgs = ["status", "pause", "resume", "next", "previous", "shuffle", "repeat", "queue"];
    if (noArgs.includes(m.command)) return Object.keys(a).length === 0;
    if (m.command === "search") return Object.keys(a).length === 1 &&
      typeof a.query === "string" && a.query.length <= 120 &&
      a.query.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(a.query);
    if (m.command === "volume" || m.command === "seek" || m.command === "queue_play") {
      const name = m.command === "volume" ? "percent" :
        m.command === "seek" ? "seconds" : "index";
      const max = m.command === "volume" ? 100 : m.command === "seek" ? 86400 : 24;
      return Object.keys(a).length === 1 &&
        Number.isInteger(a[name]) && a[name] >= 0 && a[name] <= max;
    }
    if (m.command === "select") return Object.keys(a).length === 3 &&
      typeof a.search_id === "string" && /^[a-f0-9-]{36}$/.test(a.search_id) &&
      Number.isInteger(a.index) && a.index >= 0 && a.index < 10 &&
      ["play", "next", "end"].includes(a.action);
    return false;
  }

  async function selectMusicTab() {
    const tabs = await api.tabs.query({ url: "https://music.youtube.com/*" });
    if (tabs.length !== 1 || tabs[0].discarded || !Number.isInteger(tabs[0].id))
      throw new Error(tabs.length === 0 ? "NO_MUSIC_TAB" : "AMBIGUOUS_MUSIC_TAB");
    let parsed;
    try { parsed = new URL(tabs[0].url); } catch { throw new Error("ORIGIN_DENIED"); }
    if (parsed.origin !== "https://music.youtube.com") throw new Error("ORIGIN_DENIED");
    return tabs[0].id;
  }

  function compactResponse(id, reply) {
    if (!plain(reply) || typeof reply.ok !== "boolean")
      return failure(id, "INVALID_REPLY");
    if (reply.ok !== true) {
      const code = typeof reply.error === "string" &&
        /^[A-Z_]{2,40}$/.test(reply.error) ? reply.error : "ACTION_FAILED";
      return failure(id, code);
    }
    const response = { type: "alfred.response", id, ok: true, data: reply.data };
    try {
      if (JSON.stringify(response).length <= MAX_REPLY) return response;
    } catch {}
    return failure(id, "RESPONSE_TOO_LARGE");
  }

  async function execute(message) {
    if (!validRequest(message)) return failure(Number.isSafeInteger(message?.id) ? message.id : 0, "INVALID_ARGUMENTS");
    try {
      const tabId = await selectMusicTab();
      let timer = null;
      try {
        const reply = await Promise.race([
          api.tabs.sendMessage(tabId, {
            type: "alfred.native.command", command: message.command, args: message.args
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("TIMEOUT")), 15000);
          })
        ]);
        return compactResponse(message.id, reply);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    } catch (error) {
      return failure(message.id, [
        "NO_MUSIC_TAB", "AMBIGUOUS_MUSIC_TAB", "ORIGIN_DENIED", "TIMEOUT"
      ].includes(error?.message) ? error.message : "PAGE_UNAVAILABLE");
    }
  }

  function ensureConnected() {
    if (port) return;
    try {
      const p = api.runtime.connectNative(HOST);
      port = p;
      p.onMessage.addListener(message => {
        execute(message).then(reply => {
          if (port !== p) return;
          try { p.postMessage(reply); } catch {}
        });
      });
      p.onDisconnect.addListener(() => {
        // Chrome requires the lastError property to be consumed on failed
        // native host startup. Without it DevTools emits "Unchecked runtime.lastError".
        const lastError = api.runtime.lastError?.message ?? null;
        if (port === p) port = null;
        if (lastError) console.warn("Alfred Music native host unavailable:", lastError);
      });
    } catch { port = null; }
  }

  ensureConnected();
  api.runtime.onStartup.addListener(ensureConnected);
  api.alarms.create(RETRY, { periodInMinutes: 1 });
  api.alarms.onAlarm.addListener(alarm => {
    if (alarm?.name === RETRY) ensureConnected();
  });
})();
