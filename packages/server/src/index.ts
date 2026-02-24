/**
 * Socket.IO 同步服务
 * 负责移动端与桌面端的实时通信
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { Server, type Socket } from "socket.io";
import { networkInterfaces } from "os";
import { IflytekServerAdapter } from "sa2kit/iflytek/server";

const PORT = Number(process.env.PORT) || 3001;

function getLanIPs(): string[] {
  const nets = networkInterfaces();
  const results: string[] = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

type ClientType = "mobile" | "desktop";
type ConnectionMode = "usb" | "lan";

interface ClientInfo {
  type: ClientType;
  id: string;
  mode?: ConnectionMode;
}

const clients = new Map<string, ClientInfo>();

function logClients() {
  const mobile = [...clients.values()].filter((c) => c.type === "mobile").length;
  const desktop = [...clients.values()].filter((c) => c.type === "desktop").length;
  console.log(`[在线] 手机: ${mobile}, 桌面: ${desktop}, 总计: ${clients.size}`);
}

const httpServer = createServer(
  (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", clients: clients.size }));
  },
);

const io = new Server(httpServer, {
  cors: { origin: "*" },
});

// 讯飞适配层 — 所有 WebSocket 逻辑由 sa2kit 处理
const iflytekAdapter = new IflytekServerAdapter({
  appId: process.env.IFLYTEK_APP_ID || "a920f8a5",
  apiKey: process.env.IFLYTEK_API_KEY || "e4eb4b614627bfaf54e22c78e8663602",
  apiSecret: process.env.IFLYTEK_API_SECRET || "YjM0OWJkMWQ0MDMzNzY5MjRiNWU5ODdi",
  debug: process.env.IFLYTEK_DEBUG === "1",
});

io.on("connection", (socket: Socket) => {
  console.log(`[连接] ${socket.id}`);

  // 注册讯飞适配层（自动监听 iflytek:start/audio/stop/disconnect）
  iflytekAdapter.attach(socket);

  socket.on(
    "register",
    (
      payload:
        | ClientType
        | { type: ClientType; mode?: ConnectionMode | "unknown" },
    ) => {
      const normalized =
        typeof payload === "string"
          ? { type: payload }
          : { type: payload.type, mode: payload.mode };
      clients.set(socket.id, {
        type: normalized.type,
        id: socket.id,
        mode: normalized.mode === "usb" || normalized.mode === "lan" ? normalized.mode : undefined,
      });
      console.log(
        `[注册] ${socket.id} -> ${normalized.type}${
          normalized.mode ? ` (${normalized.mode})` : ""
        }`,
      );
    logClients();
      const mobiles = [...clients.values()].filter((c) => c.type === "mobile");
      const mobileUsb = mobiles.filter((c) => c.mode === "usb").length;
      const mobileLan = mobiles.filter((c) => c.mode === "lan").length;
      io.emit("clients:status", {
        mobile: mobiles.length,
        desktop: [...clients.values()].filter((c) => c.type === "desktop").length,
        mobileMode:
          mobileUsb > 0 ? "usb" : mobileLan > 0 ? "lan" : "unknown",
      });
    },
  );

  socket.on(
    "stt:chunk",
    (data: { sessionId?: string; text: string; isFinal?: boolean }) => {
      socket.broadcast.emit("stt:chunk", data);
    },
  );

  socket.on("stt:clear", () => {
    socket.broadcast.emit("stt:clear");
  });

  socket.on("prompt:update", (data: { content: string }) => {
    socket.broadcast.emit("prompt:update", data);
  });

  socket.on("disconnect", () => {
    clients.delete(socket.id);
    console.log(`[断开] ${socket.id}`);
    logClients();
    const mobiles = [...clients.values()].filter((c) => c.type === "mobile");
    const mobileUsb = mobiles.filter((c) => c.mode === "usb").length;
    const mobileLan = mobiles.filter((c) => c.mode === "lan").length;
    io.emit("clients:status", {
      mobile: mobiles.length,
      desktop: [...clients.values()].filter((c) => c.type === "desktop").length,
      mobileMode: mobileUsb > 0 ? "usb" : mobileLan > 0 ? "lan" : "unknown",
    });
  });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("=".repeat(50));
  console.log("  同步服务已启动");
  console.log("=".repeat(50));
  console.log(`  本机访问:  http://localhost:${PORT}`);
  const ips = getLanIPs();
  for (const ip of ips) {
    console.log(`  局域网:    http://${ip}:${PORT}`);
  }
  console.log("");
  console.log("  请在手机端「设置」中填入上方局域网地址");
  console.log("=".repeat(50));
  console.log("");
});
