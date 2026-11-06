const dgram = require("dgram");
const os = require("os");

const DISCOVERY_PORT = 3457;
const DISCOVERY_MSG = "POS_DISCOVERY";
const RESPONSE_MSG = "POS_SERVER";

let socket = null;

const toInt = (ip) => String(ip).split(".").reduce((acc, n) => acc * 256 + Number(n), 0);
const networkOf = (ip, mask) => toInt(ip) - (toInt(ip) % (2 ** 32 - toInt(mask)));
const sameSubnet = (a, b, mask) => networkOf(a, mask) === networkOf(b, mask);
const isLinkLocal = (ip) => String(ip).startsWith("169.254.");

// La IP con la que este Host se anuncia a `remote`. "La primera que haya" no
// sirve: un adaptador sin red (cable suelto: 169.254.x), una VPN o VirtualBox
// pueden ir antes que el Wi-Fi, y la caja recibía una dirección a la que no
// puede llegar. Primero la de la misma subred que quien pregunta.
const pickLocalIP = (interfaces, remote) => {
  const ipv4 = Object.values(interfaces)
    .flat()
    .filter((iface) => iface.family === "IPv4" && !iface.internal);
  const match =
    remote &&
    ipv4.find((iface) => iface.netmask && sameSubnet(iface.address, remote, iface.netmask));
  if (match) return match.address;
  const usable = ipv4.find((iface) => !isLinkLocal(iface.address)) || ipv4[0];
  return usable ? usable.address : "127.0.0.1";
};

const startDiscovery = (apiPort) => {
  if (socket) stopDiscovery();

  socket = dgram.createSocket("udp4");

  socket.on("message", (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text === DISCOVERY_MSG) {
      const ip = pickLocalIP(os.networkInterfaces(), rinfo.address);
      const response = `${RESPONSE_MSG}:${ip}:${apiPort}`;
      socket.send(response, rinfo.port, rinfo.address, (err) => {
        if (err) console.error("Discovery send error:", err.message);
      });
    }
  });

  socket.on("error", (err) => {
    console.error("Discovery socket error:", err.message);
  });

  return new Promise((resolve) => {
    socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      socket.setBroadcast(true);
      console.log(`Discovery listening on port ${DISCOVERY_PORT}`);
      resolve({ success: true });
    });

    socket.on("error", (err) => {
      socket = null;
      resolve({ success: false, error: err.message });
    });
  });
};

const stopDiscovery = () => {
  if (socket) {
    socket.close();
    socket = null;
    console.log("Discovery stopped");
  }
};

const getStatus = () => ({
  running: socket !== null,
  port: DISCOVERY_PORT,
});

module.exports = { startDiscovery, stopDiscovery, getStatus, pickLocalIP };
