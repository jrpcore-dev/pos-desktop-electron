const dgram = require("dgram");
const os = require("os");

const DISCOVERY_PORT = 3457;
const DISCOVERY_MSG = "POS_DISCOVERY";
const RESPONSE_MSG = "POS_SERVER";

let socket = null;

const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "127.0.0.1";
};

const startDiscovery = (apiPort) => {
  if (socket) stopDiscovery();

  socket = dgram.createSocket("udp4");

  socket.on("message", (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text === DISCOVERY_MSG) {
      const ip = getLocalIP();
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

module.exports = { startDiscovery, stopDiscovery, getStatus };
