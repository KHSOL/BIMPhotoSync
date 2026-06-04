import { execSync, spawn } from "node:child_process";
import net from "node:net";

const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

if (major >= 24) {
  console.error("Node 24+ can fail to load the local Prisma engine on macOS. Run `nvm use` and retry.");
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [];

function getPortOwner(port) {
  if (process.platform === "win32") {
    return "";
  }

  try {
    return execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });

    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });

    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function assertPortsAvailable() {
  const ports = [
    { name: "web", port: 3001 },
    { name: "api", port: 4000 }
  ];
  const occupied = [];

  for (const target of ports) {
    if (await isPortOpen(target.port)) {
      occupied.push(target);
    }
  }

  if (occupied.length === 0) {
    return;
  }

  console.error("Cannot start local dev because required ports are already in use.");

  for (const target of occupied) {
    console.error(`\n${target.name} port ${target.port}:`);
    console.error(getPortOwner(target.port) || "Port is open, but the owning process could not be resolved.");
  }

  console.error("\nStop the existing dev server, or run:");
  console.error(`kill ${occupied.map((target) => `$(lsof -tiTCP:${target.port} -sTCP:LISTEN)`).join(" ")}`);
  process.exit(1);
}

function run(name, args) {
  const child = spawn(npm, args, {
    stdio: ["inherit", "pipe", "pipe"],
    env: process.env
  });

  children.push(child);

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    const reason = signal ? `signal ${signal}` : `code ${code ?? 0}`;
    console.error(`[${name}] exited with ${reason}`);
    shutdown(code === 0 ? 1 : (code ?? 1));
  });
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;

  for (const child of children) {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  }

  setTimeout(() => process.exit(code), 200);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

await assertPortsAvailable();

run("api", ["run", "dev:api"]);
run("web", ["run", "dev:web"]);
