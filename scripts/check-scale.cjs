// Báscula: parser de tramas + driver con un puerto simulado (sin hardware).
// Uso: node scripts/check-scale.cjs
const assert = require("assert");
const { EventEmitter } = require("events");
const path = require("path");
const scale = require(path.join(__dirname, "..", "src", "main", "scale.js"));

let failed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── Parser ──────────────────────────────────────────────────────────────
const frames = [
  ["1.234", 1.234, null],
  ["  1.234kg", 1.234, null],
  ["ST,GS,+  1.234kg", 1.234, true],
  ["US,GS,+  0.998kg", 0.998, false],
  ["S S     1.234 kg", 1.234, true],
  ["S D     1.230 kg", 1.23, false],
  ["\x02 01.234", 1.234, null],
  ["  1234 g", 1.234, null],
  ["2.000 lb", 0.907, null],
  ["-0.015kg", -0.015, null],
  ["1,250 kg", 1.25, null],
];
for (const [frame, kg, stable] of frames) {
  test(`parse ${JSON.stringify(frame)}`, () => {
    const r = scale.parseFrame(frame);
    assert.ok(r, "sin lectura");
    assert.strictEqual(r.weight, kg);
    assert.strictEqual(r.stable, stable);
    assert.strictEqual(r.overload, false);
  });
}
test("parse sobrecarga", () => {
  for (const f of ["OL", "ST,OL,+ --.--kg", "+OL"]) {
    assert.strictEqual(scale.parseFrame(f).overload, true, f);
  }
});
test("parse basura → null", () => {
  assert.strictEqual(scale.parseFrame(""), null);
  assert.strictEqual(scale.parseFrame("\r\n"), null);
  assert.strictEqual(scale.parseFrame("ERR"), null);
});
test("valida puerto (no se interpola cualquier cosa)", () => {
  assert.ok(scale.isValidPortPath("COM3"));
  assert.ok(scale.isValidPortPath("/dev/ttyUSB0"));
  assert.ok(!scale.isValidPortPath('COM3"; rm -rf'));
  assert.ok(!scale.isValidPortPath(""));
});

// ── Driver con puerto simulado ──────────────────────────────────────────
// `respond(cmd)` → texto que la "báscula" responde a ese comando.
const fakePort = (respond, { continuous } = {}) => {
  const port = new EventEmitter();
  port.isOpen = true;
  port.writes = [];
  port.write = (cmd) => {
    port.writes.push(cmd);
    const out = respond(cmd);
    if (out != null) {
      // Respuesta partida en dos fragmentos: no debe producir lecturas falsas.
      const mid = Math.floor(out.length / 2);
      setTimeout(() => port.emit("data", Buffer.from(out.slice(0, mid), "latin1")), 5);
      setTimeout(() => port.emit("data", Buffer.from(out.slice(mid), "latin1")), 15);
    }
  };
  port.close = (cb) => {
    port.isOpen = false;
    port.emit("close");
    cb && cb();
  };
  if (continuous) {
    port.timer = setInterval(() => port.emit("data", Buffer.from(continuous)), 30);
    port.on("close", () => clearInterval(port.timer));
  }
  return port;
};
const driverWith = (port) =>
  new scale.ScaleDriver({ openPort: async () => port });

test("fragmentos no generan lecturas falsas", async () => {
  const port = fakePort((c) => (c === "P" ? "  12.345kg\r\n" : null));
  const d = driverWith(port);
  await d.open("COM9", { profile: "torrey" });
  const seen = [];
  d.on("reading", (r) => seen.push(r.weight));
  const r = await d.read();
  assert.strictEqual(r.weight, 12.345);
  await new Promise((res) => setTimeout(res, 30));
  assert.deepStrictEqual(seen, [12.345]);
  await d.close();
});

test("auto detecta el protocolo W", async () => {
  const port = fakePort((c) => (c === "W" ? "\x02 01.500\r" : null));
  const d = driverWith(port);
  await d.open("COM9", { profile: "auto" });
  const r = await d.read();
  assert.strictEqual(r.weight, 1.5);
  assert.strictEqual(d.profile, "w");
  await d.close();
});

test("auto detecta transmisión continua sin enviar comandos", async () => {
  const port = fakePort(() => null, { continuous: "ST,GS,+ 0.750kg\r\n" });
  const d = driverWith(port);
  await d.open("COM9", { profile: "auto" });
  const r = await d.read();
  assert.strictEqual(r.weight, 0.75);
  assert.strictEqual(d.profile, "continuous");
  assert.strictEqual(port.writes.length, 0);
  await d.close();
});

test("stream: una petición a la vez + estabilidad por software", async () => {
  const port = fakePort((c) => (c === "P" ? "2.000\r" : null));
  const d = driverWith(port);
  await d.open("COM9", { profile: "torrey" });
  const seen = [];
  d.on("reading", (r) => seen.push(r));
  d.startStream(20);
  await new Promise((res) => setTimeout(res, 300));
  d.stopStream();
  assert.ok(seen.length >= 3, `lecturas: ${seen.length}`);
  // Nunca más peticiones que respuestas + 1 en vuelo.
  assert.ok(port.writes.length <= seen.length + 1);
  assert.strictEqual(seen[0].stable, false);
  assert.strictEqual(seen[seen.length - 1].stable, true);
  await d.close();
});

test("desconexión física cierra el driver", async () => {
  const port = fakePort(() => null);
  const d = driverWith(port);
  await d.open("COM9", { profile: "torrey" });
  let closed = false;
  d.on("close", () => (closed = true));
  port.emit("close");
  assert.ok(closed);
  assert.strictEqual(d.isOpen, false);
});

(async () => {
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${t.name}: ${err.message}`);
    }
  }
  console.log(failed ? `\n${failed} fallaron` : `\n${tests.length} OK`);
  process.exit(failed ? 1 : 0);
})();
