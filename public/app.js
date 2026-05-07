const state = {
  settings: null,
  instances: [],
  current: null,
  schema: [],
  categories: [],
  configValues: {},
  customConfigs: [],
};

const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function toast(message) {
  const node = $("toast");
  node.textContent = message;
  node.classList.remove("hidden");
  setTimeout(() => node.classList.add("hidden"), 3200);
}

async function loadAll() {
  const [settings, instances, schemaData] = await Promise.all([
    api("/api/settings"),
    api("/api/instances"),
    api("/api/config-schema"),
  ]);
  state.settings = settings;
  state.instances = instances;
  state.schema = schemaData.schema;
  state.categories = schemaData.categories;
  renderSettings();
  renderInstances();
  if (state.current) {
    const latest = state.instances.find((item) => item.id === state.current.id);
    if (latest) await selectInstance(latest.id);
  }
}

function renderSettings() {
  $("steamcmdPath").value = state.settings.steamcmdPath || "";
  $("defaultInstallRoot").value = state.settings.defaultInstallRoot || "";
  $("webPort").value = state.settings.port || 3050;
}

function renderInstances() {
  const list = $("instanceList");
  list.innerHTML = "";
  if (!state.instances.length) {
    list.innerHTML = '<p class="muted">还没有私服实例。</p>';
    return;
  }
  for (const instance of state.instances) {
    const button = document.createElement("button");
    button.className = `instance-card ${state.current?.id === instance.id ? "active" : ""}`;
    button.innerHTML = `
      <strong>${escapeHtml(instance.name)}</strong>
      <span class="muted">${escapeHtml(instance.runtime?.status || "已停止")} · ${escapeHtml(instance.map || "")}</span>
    `;
    button.onclick = () => selectInstance(instance.id);
    list.appendChild(button);
  }
}

async function selectInstance(id) {
  state.current = await api(`/api/instances/${encodeURIComponent(id)}`);
  const config = await api(`/api/instances/${encodeURIComponent(id)}/config`);
  state.configValues = { ...config.values };
  state.customConfigs = [...config.customConfigs];
  $("emptyState").classList.add("hidden");
  $("detailView").classList.remove("hidden");
  renderInstances();
  renderDetail();
  renderConfig();
}

function renderDetail() {
  const instance = state.current;
  $("instanceTitle").textContent = instance.name;
  $("instanceStatus").textContent = instance.runtime?.status || "已停止";
  $("instancePath").textContent = instance.resolvedInstallDir || "";
  $("nameInput").value = instance.name || "";
  $("mapInput").value = instance.map || "";
  $("installDirInput").value = instance.installDir || instance.resolvedInstallDir || "";
  $("gamePortInput").value = instance.ports?.game || 7777;
  $("queryPortInput").value = instance.ports?.query || 27015;
  $("rconPortInput").value = instance.ports?.rcon || 27020;
  $("modsInput").value = (instance.mods || []).join("\n");
  $("extraArgsInput").value = instance.launch?.extraArgs || "";
}

function renderConfig() {
  const query = $("configSearch").value.trim().toLowerCase();
  const root = $("configGroups");
  root.innerHTML = "";
  for (const category of state.categories) {
    const items = state.schema.filter((item) => {
      if (item.categoryZh !== category) return false;
      const haystack = `${item.displayNameZh} ${item.descriptionZh} ${item.key}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    if (!items.length) continue;

    const group = document.createElement("section");
    group.className = "config-group";
    group.innerHTML = `<h3>${category}</h3><div class="config-list"></div>`;
    const list = group.querySelector(".config-list");
    for (const item of items) list.appendChild(renderConfigItem(item));
    root.appendChild(group);
  }
  renderCustomConfigs();
}

function renderConfigItem(item) {
  const value = state.configValues[item.key] ?? item.defaultValue;
  const changed = String(value) !== String(item.defaultValue);
  const wrap = document.createElement("article");
  wrap.className = `config-item ${changed ? "changed" : ""}`;
  wrap.innerHTML = `
    <div class="config-title">
      <strong>${escapeHtml(item.displayNameZh)}</strong>
      ${changed ? '<span class="pill">已修改</span>' : ""}
    </div>
    <div class="config-desc">${escapeHtml(item.descriptionZh)}</div>
    <div class="config-meta">
      <span class="pill">默认：${escapeHtml(formatValue(item, item.defaultValue))}</span>
      <span class="pill">${item.restartRequired ? "重启后生效" : "立即生效"}</span>
      <span class="pill">原始 key：${escapeHtml(item.key)}</span>
    </div>
  `;
  wrap.appendChild(inputForItem(item, value));
  return wrap;
}

function inputForItem(item, value) {
  let input;
  if (item.type === "boolean") {
    input = document.createElement("select");
    input.innerHTML = `
      <option value="true">${item.optionLabelsZh?.true || "开启"}</option>
      <option value="false">${item.optionLabelsZh?.false || "关闭"}</option>
    `;
    input.value = value === true || value === "true" || value === "True" ? "true" : "false";
    input.onchange = () => {
      state.configValues[item.key] = input.value === "true";
      renderConfig();
    };
    return input;
  }
  if (item.type === "text") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else {
    input = document.createElement("input");
    input.type = item.type === "number" ? "number" : "text";
    if (item.min !== undefined) input.min = item.min;
    if (item.max !== undefined) input.max = item.max;
    if (item.step !== undefined) input.step = item.step;
  }
  input.value = value ?? "";
  input.oninput = () => {
    state.configValues[item.key] = item.type === "number" ? Number(input.value) : input.value;
  };
  return input;
}

function renderCustomConfigs() {
  const root = $("customList");
  root.innerHTML = "";
  for (const [index, item] of state.customConfigs.entries()) {
    const row = document.createElement("div");
    row.className = "custom-row";
    row.innerHTML = `
      <input placeholder="文件" value="${escapeAttr(item.file || "GameUserSettings.ini")}">
      <input placeholder="Section" value="${escapeAttr(item.section || "ServerSettings")}">
      <input placeholder="原始 key" value="${escapeAttr(item.key || "")}">
      <input placeholder="值" value="${escapeAttr(item.value || "")}">
      <input placeholder="中文备注" value="${escapeAttr(item.noteZh || "")}">
      <button>删除</button>
    `;
    const inputs = row.querySelectorAll("input");
    const fields = ["file", "section", "key", "value", "noteZh"];
    inputs.forEach((input, fieldIndex) => {
      input.oninput = () => {
        state.customConfigs[index][fields[fieldIndex]] = input.value;
      };
    });
    row.querySelector("button").onclick = () => {
      state.customConfigs.splice(index, 1);
      renderCustomConfigs();
    };
    root.appendChild(row);
  }
}

function collectInstanceForm() {
  return {
    name: $("nameInput").value.trim(),
    map: $("mapInput").value.trim(),
    installDir: $("installDirInput").value.trim(),
    ports: {
      game: Number($("gamePortInput").value),
      query: Number($("queryPortInput").value),
      rcon: Number($("rconPortInput").value),
    },
    mods: $("modsInput").value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean),
    launch: {
      ...(state.current.launch || {}),
      extraArgs: $("extraArgsInput").value.trim(),
    },
  };
}

async function saveInstance() {
  state.current = await api(`/api/instances/${encodeURIComponent(state.current.id)}`, {
    method: "PUT",
    body: JSON.stringify(collectInstanceForm()),
  });
  toast("基础配置已保存");
  await loadAll();
}

async function saveConfig(syncToIni = false) {
  await api(`/api/instances/${encodeURIComponent(state.current.id)}/config`, {
    method: "PUT",
    body: JSON.stringify({
      values: state.configValues,
      customConfigs: state.customConfigs,
      syncToIni,
    }),
  });
  toast(syncToIni ? "配置已保存并同步到 INI" : "配置已保存");
  await selectInstance(state.current.id);
}

async function runAction(suffix, success) {
  await api(`/api/instances/${encodeURIComponent(state.current.id)}/${suffix}`, { method: "POST", body: "{}" });
  toast(success);
  await loadAll();
}

function formatValue(item, value) {
  if (item.type === "boolean") {
    const bool = value === true || value === "true" || value === "True";
    return bool ? item.optionLabelsZh?.true || "开启" : item.optionLabelsZh?.false || "关闭";
  }
  return `${value ?? ""}${item.unitZh ? ` ${item.unitZh}` : ""}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

document.querySelectorAll(".tabs button").forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll(".tabs button").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.add("hidden"));
    button.classList.add("active");
    $(`tab-${button.dataset.tab}`).classList.remove("hidden");
  };
});

$("refreshBtn").onclick = () => loadAll().then(() => toast("状态已刷新")).catch((error) => toast(error.message));
$("createBtn").onclick = async () => {
  const instance = await api("/api/instances", {
    method: "POST",
    body: JSON.stringify({ name: "新建方舟私服" }),
  });
  await loadAll();
  await selectInstance(instance.id);
};
$("saveSettingsBtn").onclick = async () => {
  state.settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      ...state.settings,
      steamcmdPath: $("steamcmdPath").value.trim(),
      defaultInstallRoot: $("defaultInstallRoot").value.trim(),
      port: Number($("webPort").value),
    }),
  });
  toast("全局设置已保存，端口变更需重启面板");
};
$("saveInstanceBtn").onclick = () => saveInstance().catch((error) => toast(error.message));
$("configSearch").oninput = renderConfig;
$("resetDefaultsBtn").onclick = () => {
  state.configValues = Object.fromEntries(state.schema.map((item) => [item.key, item.defaultValue]));
  renderConfig();
};
$("saveConfigBtn").onclick = () => saveConfig(false).catch((error) => toast(error.message));
$("saveSyncConfigBtn").onclick = () => saveConfig(true).catch((error) => toast(error.message));
$("saveRestartBtn").onclick = async () => {
  await saveConfig(true);
  await runAction("restart", "配置已保存并重启");
};
$("addCustomBtn").onclick = () => {
  state.customConfigs.push({ file: "GameUserSettings.ini", section: "ServerSettings", key: "", value: "", noteZh: "" });
  renderCustomConfigs();
};
$("installBtn").onclick = () => runAction("install", "安装/更新已启动").catch((error) => toast(error.message));
$("startBtn").onclick = () => runAction("start", "服务器已启动").catch((error) => toast(error.message));
$("stopBtn").onclick = () => runAction("stop", "服务器已停止").catch((error) => toast(error.message));
$("restartBtn").onclick = () => runAction("restart", "服务器已重启").catch((error) => toast(error.message));
$("loadRawBtn").onclick = async () => {
  const file = $("rawFileSelect").value;
  const data = await api(`/api/instances/${encodeURIComponent(state.current.id)}/ini/${encodeURIComponent(file)}`);
  $("rawIniText").value = data.content;
  toast("INI 已导入到编辑区");
};
$("saveRawBtn").onclick = async () => {
  const file = $("rawFileSelect").value;
  await api(`/api/instances/${encodeURIComponent(state.current.id)}/ini/${encodeURIComponent(file)}`, {
    method: "PUT",
    body: JSON.stringify({ content: $("rawIniText").value }),
  });
  toast("原始 INI 已保存");
};
$("loadLogsBtn").onclick = async () => {
  const data = await api(`/api/instances/${encodeURIComponent(state.current.id)}/logs`);
  $("logsBox").textContent = data.log || "暂无日志";
};

loadAll().catch((error) => toast(error.message));
