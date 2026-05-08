import { spawn } from "node:child_process";
import os from "node:os";

function runPowerShell(command) {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", command], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell 命令失败，退出码 ${code}`));
    });
  });
}

export function peerPortForInstance(instance) {
  return Number(instance.ports?.peer) || Number(instance.ports?.game || 7777) + 1;
}

export function requiredPorts(instance) {
  return {
    game: Number(instance.ports?.game) || 7777,
    peer: peerPortForInstance(instance),
    query: Number(instance.ports?.query) || 27015,
    rcon: Number(instance.ports?.rcon) || 27020,
  };
}

export function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

export function connectionInfoForInstance(instance) {
  const ports = requiredPorts(instance);
  const addresses = lanAddresses();
  const host = addresses[0] || "127.0.0.1";
  const address = `${host}:${ports.game}`;
  return {
    host,
    addresses,
    port: ports.game,
    address,
    consoleCommand: `open ${address}`,
    steamConnectUrl: `steam://connect/${address}`,
    note: "ASA 可靠直连方式是在游戏控制台执行 open IP:端口；Steam 链接仅作为候选方式，可能不被当前 ASA 版本接管。",
  };
}

export async function getPortStatus(instance) {
  const ports = requiredPorts(instance);
  if (process.platform !== "win32") {
    return {
      ports,
      listeners: [],
      supported: false,
      message: "端口监听检测需要在 Windows 主机上运行",
    };
  }
  const udpPorts = [ports.game, ports.peer, ports.query].join(",");
  const tcpPorts = [ports.rcon].join(",");
  const script = [
    `$udp = Get-NetUDPEndpoint -LocalPort ${udpPorts} -ErrorAction SilentlyContinue | Select-Object @{n='protocol';e={'UDP'}},LocalAddress,LocalPort,OwningProcess`,
    `$tcp = Get-NetTCPConnection -LocalPort ${tcpPorts} -ErrorAction SilentlyContinue | Select-Object @{n='protocol';e={'TCP'}},LocalAddress,LocalPort,OwningProcess,State`,
    `$all = @($udp) + @($tcp)`,
    `$all | ConvertTo-Json -Compress`,
  ].join("; ");
  const raw = await runPowerShell(script);
  const parsed = raw ? JSON.parse(raw) : [];
  return {
    ports,
    listeners: Array.isArray(parsed) ? parsed : [parsed],
    supported: true,
  };
}

export async function ensureFirewallRules(instance) {
  const ports = requiredPorts(instance);
  if (process.platform !== "win32") {
    return {
      supported: false,
      message: "防火墙规则创建需要在 Windows 主机上运行",
      ports,
    };
  }
  const rules = [
    {
      name: `ASA ${instance.id} UDP`,
      protocol: "UDP",
      ports: `${ports.game},${ports.peer},${ports.query}`,
    },
    {
      name: `ASA ${instance.id} RCON TCP`,
      protocol: "TCP",
      ports: `${ports.rcon}`,
    },
  ];
  for (const rule of rules) {
    const script = [
      `$name = ${JSON.stringify(rule.name)}`,
      `Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule`,
      `New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol ${rule.protocol} -LocalPort ${rule.ports} | Out-Null`,
    ].join("; ");
    try {
      await runPowerShell(script);
    } catch (error) {
      const permissionDenied = /PermissionDenied|System Error 5|拒绝访问|權限|Access is denied/i.test(error.message);
      return {
        supported: true,
        ok: false,
        ports,
        rules,
        message: permissionDenied
          ? "创建防火墙规则失败：权限不足，请用管理员权限运行开服器"
          : `创建防火墙规则失败：${error.message}`,
      };
    }
  }
  return { supported: true, ok: true, ports, rules, message: "防火墙规则已创建" };
}
