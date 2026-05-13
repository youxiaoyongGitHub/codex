const state = {
  settings: null,
  instances: [],
  current: null,
  schema: [],
  categories: [],
  maps: [],
  configValues: {},
  customConfigs: [],
  connection: null,
  backups: [],
  saveDir: "",
  clusters: [],
  selectedClusterId: "",
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
  const [settings, instances, schemaData, mapsData] = await Promise.all([
    api("/api/settings"),
    api("/api/instances"),
    api("/api/config-schema"),
    api("/api/maps"),
  ]);
  state.settings = settings;
  state.instances = instances;
  state.schema = schemaData.schema;
  state.categories = schemaData.categories;
  state.maps = mapsData.maps;
  renderSettings();
  renderImportMapOptions();
  renderInstances();
  try {
    const clustersData = await api("/api/clusters");
    state.clusters = clustersData.clusters || [];
  } catch (error) {
    state.clusters = [];
    toast(`集群列表加载失败：${error.message}`);
  }
  if (!state.selectedClusterId && state.clusters.length) state.selectedClusterId = state.clusters[0].id;
  renderClusterTab();
  if (state.current) {
    const latest = state.instances.find((item) => item.id === state.current.id);
    if (latest) await selectInstance(latest.id);
    else {
      state.current = null;
      $("detailView").classList.add("hidden");
      $("emptyState").classList.remove("hidden");
    }
  }
}

function renderSettings() {
  $("steamcmdPath").value = state.settings.steamcmdPath || "";
  $("defaultInstallRoot").value = state.settings.defaultInstallRoot || "";
  $("steamcmdInstallDir").value = state.settings.steamcmdInstallDir || "";
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
      ${instance.clusterId ? '<span class="pill">已加入集群</span>' : ""}
    `;
    button.onclick = () => selectInstance(instance.id);
    list.appendChild(button);
  }
}

async function selectInstance(id) {
  state.current = await api(`/api/instances/${encodeURIComponent(id)}`);
  const config = await api(`/api/instances/${encodeURIComponent(id)}/config`);
  try {
    state.connection = await api(`/api/instances/${encodeURIComponent(id)}/connection`);
  } catch (error) {
    state.connection = null;
    toast(`直连信息加载失败：${error.message}`);
  }
  try {
    const backupData = await api(`/api/instances/${encodeURIComponent(id)}/backups`);
    state.backups = backupData.backups || [];
    state.saveDir = backupData.saveDir || "";
  } catch (error) {
    state.backups = [];
    state.saveDir = "";
    toast(`备份信息加载失败：${error.message}`);
  }
  state.configValues = { ...config.values };
  state.customConfigs = [...config.customConfigs];
  $("emptyState").classList.add("hidden");
  $("detailView").classList.remove("hidden");
  renderInstances();
  renderDetail();
  renderConnection();
  renderInstanceClusterInfo();
  renderBackups();
  renderClusterTab();
  renderConfig();
  await loadRawIni(false);
}

function renderDetail() {
  const instance = state.current;
  $("instanceTitle").textContent = instance.name;
  $("instanceStatus").textContent = instance.runtime?.status || "已停止";
  $("instancePath").textContent = instance.resolvedInstallDir || "";
  $("nameInput").value = instance.name || "";
  renderMapOptions(instance.map || "", $("mapSearchInput").value);
  $("installDirInput").value = instance.installDir || instance.resolvedInstallDir || "";
  $("gamePortInput").value = instance.ports?.game || 7777;
  $("peerPortInput").value = instance.ports?.peer || Number(instance.ports?.game || 7777) + 1;
  $("queryPortInput").value = instance.ports?.query || 27015;
  $("rconPortInput").value = instance.ports?.rcon || 27020;
  $("cultureSelect").value = instance.launch?.culture || "zh";
  if (!$("cultureSelect").value) $("cultureSelect").value = "zh";
  $("modsInput").value = (instance.mods || []).join("\n");
  renderModDetails();
  $("extraArgsInput").value = instance.launch?.extraArgs || "";
}

function renderConnection() {
  const info = state.connection;
  $("connectionBox").classList.toggle("hidden", !info);
  if (!info) return;
  $("connectionNote").textContent = info.note || "";
  $("connectionAddress").value = info.address || "";
  $("connectionCommand").value = info.consoleCommand || "";
  $("steamConnectLink").href = info.steamConnectUrl || "#";
}

function renderInstanceClusterInfo() {
  const cluster = state.clusters.find((item) => item.id === state.current?.clusterId);
  $("instanceClusterBox").classList.toggle("hidden", !cluster);
  if (!cluster) return;
  $("instanceClusterSummary").textContent = `集群：${cluster.name}；ARK cluster id：${cluster.arkClusterId}；共享目录：${cluster.clusterDir}`;
  const root = $("instanceClusterMembers");
  root.innerHTML = "";
  for (const member of cluster.members || []) {
    const card = document.createElement("div");
    card.className = "cluster-member-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <div class="cluster-meta">
          <span class="pill">${escapeHtml(member.map || "")}</span>
          <span class="pill">${escapeHtml(member.runtime?.status || "已停止")}</span>
          <span class="pill">端口 ${escapeHtml(member.ports?.game || "")}</span>
        </div>
      </div>
    `;
    root.appendChild(card);
  }
}

function renderBackups() {
  $("saveDirText").textContent = `当前存档目录：${state.saveDir || "未安装或未生成"}`;
  const root = $("backupList");
  root.innerHTML = "";
  if (!state.backups.length) {
    root.innerHTML = '<p class="muted">暂无备份。服务器生成存档后，可以点击“立即备份”。</p>';
    return;
  }
  for (const backup of state.backups) {
    const card = document.createElement("article");
    card.className = "backup-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(formatDateTime(backup.createdAt) || backup.id)}</strong>
        <div class="backup-meta">
          <span class="pill">地图：${escapeHtml(backup.map || "未知")}</span>
          <span class="pill">大小：${escapeHtml(formatBytes(backup.sizeBytes))}</span>
          ${backup.note ? `<span class="pill">${escapeHtml(backup.note)}</span>` : ""}
        </div>
        <p class="muted">${escapeHtml(backup.id)}</p>
      </div>
      <button class="danger">恢复此备份</button>
    `;
    card.querySelector("button").onclick = () => restoreBackup(backup.id).catch((error) => toast(error.message));
    root.appendChild(card);
  }
}

function renderClusterTab() {
  const select = $("clusterSelect");
  select.innerHTML = state.clusters.map((cluster) => (
    `<option value="${escapeAttr(cluster.id)}">${escapeHtml(cluster.name)}（${escapeHtml(cluster.arkClusterId)}）</option>`
  )).join("");
  if (state.selectedClusterId && state.clusters.some((cluster) => cluster.id === state.selectedClusterId)) {
    select.value = state.selectedClusterId;
  } else if (state.clusters.length) {
    state.selectedClusterId = state.clusters[0].id;
    select.value = state.selectedClusterId;
  } else {
    state.selectedClusterId = "";
  }

  const cluster = selectedCluster();
  $("clusterNameInput").value = cluster?.name || "";
  $("clusterArkIdInput").value = cluster?.arkClusterId || "";
  $("clusterDirInput").value = cluster?.clusterDir || "";
  $("clusterDirStatus").textContent = cluster ? `目录状态：${cluster.directory?.exists ? "已存在" : "尚未创建"} · ${cluster.directory?.path || cluster.clusterDir}` : "暂无集群，请先新建集群。";
  $("saveClusterBtn").disabled = !cluster;
  $("deleteClusterBtn").disabled = !cluster;
  $("addClusterMemberBtn").disabled = !cluster || !state.instances.length;
  renderClusterInstanceOptions(cluster);
  renderClusterMembers(cluster);
}

function selectedCluster() {
  return state.clusters.find((cluster) => cluster.id === state.selectedClusterId) || null;
}

function renderClusterInstanceOptions(cluster) {
  const select = $("clusterInstanceSelect");
  const memberIds = new Set(cluster?.memberInstanceIds || []);
  const candidates = state.instances.filter((instance) => !memberIds.has(instance.id));
  select.innerHTML = candidates.map((instance) => {
    const current = instance.clusterId ? " · 将从原集群移入" : "";
    return `<option value="${escapeAttr(instance.id)}">${escapeHtml(instance.name)}（${escapeHtml(instance.map || "")}${current}）</option>`;
  }).join("");
  if (!candidates.length) {
    select.innerHTML = '<option value="">没有可加入的实例</option>';
  }
}

function renderClusterMembers(cluster) {
  const root = $("clusterMembersList");
  root.innerHTML = "";
  if (!cluster) {
    root.innerHTML = '<p class="muted">暂无集群。</p>';
    return;
  }
  if (!cluster.members?.length) {
    root.innerHTML = '<p class="muted">该集群还没有实例成员。</p>';
    return;
  }
  for (const member of cluster.members) {
    const card = document.createElement("article");
    card.className = "cluster-member-card";
    card.innerHTML = `
      <div>
        <strong>${escapeHtml(member.name)}</strong>
        <div class="cluster-meta">
          <span class="pill">地图：${escapeHtml(member.map || "")}</span>
          <span class="pill">状态：${escapeHtml(member.runtime?.status || "已停止")}</span>
          <span class="pill">游戏端口：${escapeHtml(member.ports?.game || "")}</span>
          <span class="pill">查询端口：${escapeHtml(member.ports?.query || "")}</span>
        </div>
      </div>
      <button class="danger">移出集群</button>
    `;
    card.querySelector("button").onclick = () => removeClusterMember(member.id).catch((error) => toast(error.message));
    root.appendChild(card);
  }
}

function renderMapOptions(mapId, queryValue = "") {
  const select = $("mapSelect");
  const known = state.maps.some((map) => map.id === mapId);
  const query = String(queryValue || "").trim().toLowerCase();
  const maps = state.maps.filter((map) => {
    const haystack = [
      map.id,
      map.displayNameZh,
      map.englishName,
      map.typeZh,
      ...(map.aliasesZh || []),
    ].join(" ").toLowerCase();
    return !query || haystack.includes(query);
  });
  const selectedMap = state.maps.find((map) => map.id === mapId);
  if (selectedMap && !maps.some((map) => map.id === selectedMap.id)) maps.unshift(selectedMap);
  select.innerHTML = maps.map((map) => {
    const aliases = map.aliasesZh?.length ? ` · 别名：${map.aliasesZh.join("、")}` : "";
    return `<option value="${escapeAttr(map.id)}">${escapeHtml(map.displayNameZh)}（${escapeHtml(map.englishName)} · ${escapeHtml(map.typeZh)}${escapeHtml(aliases)}）</option>`;
  }).join("") + '<option value="__custom__">自定义地图启动名</option>';
  select.value = known ? mapId : "__custom__";
  $("customMapLabel").classList.toggle("hidden", known);
  $("customMapInput").value = known ? "" : mapId;
}

function renderImportMapOptions() {
  const select = $("importMapSelect");
  select.innerHTML = state.maps.map((map) => (
    `<option value="${escapeAttr(map.id)}">${escapeHtml(map.displayNameZh)}（${escapeHtml(map.englishName)}）</option>`
  )).join("");
}

function currentModIds() {
  return $("modsInput").value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function renderModDetails() {
  const root = $("modDetailsList");
  const ids = currentModIds();
  root.innerHTML = "";
  if (!ids.length) {
    root.innerHTML = '<p class="muted">添加 Mod ID 后，可在这里填写中文显示名称。</p>';
    return;
  }
  const details = state.current.modDetails || {};
  for (const id of ids) {
    const card = document.createElement("div");
    card.className = "mod-detail-card";
    card.innerHTML = `
      <div>
        <span class="muted">Mod ID</span>
        <strong>${escapeHtml(id)}</strong>
      </div>
      <label>
        <span>中文显示名称</span>
        <input value="${escapeAttr(details[id]?.displayNameZh || "")}" placeholder="例如 自动门、叠加模组、恐龙扩展" />
      </label>
    `;
    card.querySelector("input").oninput = (event) => {
      state.current.modDetails = state.current.modDetails || {};
      state.current.modDetails[id] = { displayNameZh: event.target.value.trim() };
    };
    root.appendChild(card);
  }
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
  const modIds = currentModIds();
  const modDetails = {};
  for (const id of modIds) {
    const detail = state.current.modDetails?.[id];
    if (detail?.displayNameZh) modDetails[id] = { displayNameZh: detail.displayNameZh };
  }
  return {
    name: $("nameInput").value.trim(),
    map: $("mapSelect").value === "__custom__" ? $("customMapInput").value.trim() : $("mapSelect").value,
    installDir: $("installDirInput").value.trim(),
    ports: {
      game: Number($("gamePortInput").value),
      peer: Number($("peerPortInput").value),
      query: Number($("queryPortInput").value),
      rcon: Number($("rconPortInput").value),
    },
    mods: modIds,
    modDetails,
    launch: {
      ...(state.current.launch || {}),
      culture: $("cultureSelect").value,
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
  if (["start", "restart"].includes(suffix) && state.current) {
    state.connection = await api(`/api/instances/${encodeURIComponent(state.current.id)}/connection`);
    renderConnection();
    await loadRawIni(false);
  }
}

async function loadBackups() {
  const data = await api(`/api/instances/${encodeURIComponent(state.current.id)}/backups`);
  state.backups = data.backups || [];
  state.saveDir = data.saveDir || "";
  renderBackups();
}

async function loadClusters() {
  const data = await api("/api/clusters");
  state.clusters = data.clusters || [];
  renderClusterTab();
  renderInstanceClusterInfo();
}

async function createCluster() {
  const cluster = await api("/api/clusters", {
    method: "POST",
    body: JSON.stringify({ name: "新建方舟集群" }),
  });
  state.selectedClusterId = cluster.id;
  toast("集群已创建");
  await loadAll();
}

async function loadImportCandidates() {
  const data = await api("/api/imports/singleplayer/candidates");
  const saveDir = data.candidates?.saveDirs?.[0];
  const configDir = data.candidates?.configDirs?.[0];
  if (saveDir && !$("importSaveDirInput").value.trim()) $("importSaveDirInput").value = saveDir;
  if (configDir && !$("importConfigDirInput").value.trim()) $("importConfigDirInput").value = configDir;
  toast("已填入推荐路径，请根据实际单机目录确认");
}

async function importSingleplayer() {
  $("importSingleplayerBtn").disabled = true;
  try {
    const result = await api("/api/imports/singleplayer", {
      method: "POST",
      body: JSON.stringify({
        name: $("importNameInput").value.trim() || "单机导入服务器",
        map: $("importMapSelect").value,
        saveDir: $("importSaveDirInput").value.trim(),
        configDir: $("importConfigDirInput").value.trim(),
        installDir: $("importInstallDirInput").value.trim(),
      }),
    });
    toast(`单机存档已导入：${result.instance.name}`);
    await loadAll();
    await selectInstance(result.instance.id);
  } finally {
    $("importSingleplayerBtn").disabled = false;
  }
}

async function saveCluster() {
  const cluster = selectedCluster();
  if (!cluster) return;
  await api(`/api/clusters/${encodeURIComponent(cluster.id)}`, {
    method: "PUT",
    body: JSON.stringify({
      name: $("clusterNameInput").value.trim(),
      arkClusterId: $("clusterArkIdInput").value.trim(),
      clusterDir: $("clusterDirInput").value.trim(),
    }),
  });
  toast("集群已保存");
  await loadAll();
}

async function deleteCluster() {
  const cluster = selectedCluster();
  if (!cluster || !confirm(`确定删除集群“${cluster.name}”记录吗？不会删除共享目录。`)) return;
  await api(`/api/clusters/${encodeURIComponent(cluster.id)}`, { method: "DELETE" });
  state.selectedClusterId = "";
  toast("集群记录已删除");
  await loadAll();
}

async function addClusterMember() {
  const cluster = selectedCluster();
  const instanceId = $("clusterInstanceSelect").value;
  if (!cluster) {
    toast("请先创建或选择集群");
    return;
  }
  if (!instanceId) {
    toast("没有可加入该集群的实例");
    return;
  }
  await api(`/api/clusters/${encodeURIComponent(cluster.id)}/members`, {
    method: "POST",
    body: JSON.stringify({ instanceId }),
  });
  toast("实例已加入集群");
  await loadAll();
}

async function removeClusterMember(instanceId) {
  const cluster = selectedCluster();
  if (!cluster) return;
  await api(`/api/clusters/${encodeURIComponent(cluster.id)}/members/${encodeURIComponent(instanceId)}`, { method: "DELETE" });
  toast("实例已移出集群");
  await loadAll();
}

async function createBackup() {
  $("createBackupBtn").disabled = true;
  try {
    const backup = await api(`/api/instances/${encodeURIComponent(state.current.id)}/backups`, { method: "POST", body: "{}" });
    toast(`存档备份已创建：${backup.id}`);
    await loadBackups();
  } finally {
    $("createBackupBtn").disabled = false;
  }
}

async function restoreBackup(backupId) {
  if (!confirm("恢复会覆盖当前存档。面板会先自动备份当前存档，确认继续？")) return;
  const result = await api(`/api/instances/${encodeURIComponent(state.current.id)}/backups/${encodeURIComponent(backupId)}/restore`, {
    method: "POST",
    body: "{}",
  });
  toast(`存档已恢复：${result.restoredFrom}`);
  await loadBackups();
}

async function loadRawIni(showToast = true) {
  if (!state.current) return;
  const file = $("rawFileSelect").value;
  const data = await api(`/api/instances/${encodeURIComponent(state.current.id)}/ini/${encodeURIComponent(file)}`);
  $("rawIniPath").textContent = `文件路径：${data.path}`;
  $("rawIniText").value = data.content;
  $("rawIniHint").textContent = data.content ? "" : data.emptyMessage || "INI 文件为空或尚未生成。";
  if (showToast) toast("INI 内容已刷新");
}

function formatValue(item, value) {
  if (item.type === "boolean") {
    const bool = value === true || value === "true" || value === "True";
    return bool ? item.optionLabelsZh?.true || "开启" : item.optionLabelsZh?.false || "关闭";
  }
  return `${value ?? ""}${item.unitZh ? ` ${item.unitZh}` : ""}`;
}

function formatBytes(value) {
  const size = Number(value);
  if (!Number.isFinite(size) || size <= 0) return "未知";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", { hour12: false });
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

$("mapSelect").onchange = () => {
  const custom = $("mapSelect").value === "__custom__";
  $("customMapLabel").classList.toggle("hidden", !custom);
  if (custom && !$("customMapInput").value.trim()) $("customMapInput").focus();
};
$("mapSearchInput").oninput = () => renderMapOptions(state.current?.map || "", $("mapSearchInput").value);
$("modsInput").oninput = renderModDetails;
$("loadImportCandidatesBtn").onclick = () => loadImportCandidates().catch((error) => toast(error.message));
$("importSingleplayerBtn").onclick = () => importSingleplayer().catch((error) => toast(error.message));
$("saveSettingsBtn").onclick = async () => {
  state.settings = await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({
      ...state.settings,
      steamcmdPath: $("steamcmdPath").value.trim(),
      steamcmdInstallDir: $("steamcmdInstallDir").value.trim(),
      defaultInstallRoot: $("defaultInstallRoot").value.trim(),
      port: Number($("webPort").value),
    }),
  });
  toast("全局设置已保存，端口变更需重启面板");
};
$("findSteamcmdBtn").onclick = async () => {
  const result = await api("/api/steamcmd/find");
  if (!result.found) {
    toast(`未找到 SteamCMD，已检查 ${result.searched} 个位置`);
    return;
  }
  $("steamcmdPath").value = result.bestPath;
  state.settings.steamcmdPath = result.bestPath;
  toast(`已找到 SteamCMD：${result.bestPath}`);
};
$("installSteamcmdBtn").onclick = async () => {
  try {
    const installDir = $("steamcmdInstallDir").value.trim();
    toast("正在下载并安装 SteamCMD，请稍候");
    const result = await api("/api/steamcmd/install", {
      method: "POST",
      body: JSON.stringify({ installDir }),
    });
    state.settings = result.settings;
    $("steamcmdPath").value = result.executablePath;
    $("steamcmdInstallDir").value = result.installDir;
    toast(`SteamCMD 已安装：${result.executablePath}`);
  } catch (error) {
    toast(error.message);
  }
};
$("saveInstanceBtn").onclick = () => saveInstance().catch((error) => toast(error.message));
$("firewallBtn").onclick = async () => {
  try {
    $("portStatusBox").textContent = "正在创建防火墙规则...";
    const result = await api(`/api/instances/${encodeURIComponent(state.current.id)}/firewall`, { method: "POST", body: "{}" });
    $("portStatusBox").textContent = JSON.stringify(result, null, 2);
    toast(result.message || (result.ok ? "防火墙规则已创建" : "防火墙规则创建失败"));
  } catch (error) {
    $("portStatusBox").textContent = `创建防火墙规则失败：${error.message}`;
    toast(error.message);
  }
};
$("checkPortsBtn").onclick = async () => {
  try {
    const result = await api(`/api/instances/${encodeURIComponent(state.current.id)}/ports`);
    $("portStatusBox").textContent = JSON.stringify(result, null, 2);
    toast("端口监听状态已刷新");
  } catch (error) {
    toast(error.message);
  }
};
$("copyAddressBtn").onclick = () => copyText($("connectionAddress").value, "连接地址已复制");
$("copyCommandBtn").onclick = () => copyText($("connectionCommand").value, "控制台命令已复制");
$("refreshBackupsBtn").onclick = () => loadBackups().then(() => toast("备份列表已刷新")).catch((error) => toast(error.message));
$("createBackupBtn").onclick = () => createBackup().catch((error) => toast(error.message));
$("refreshClustersBtn").onclick = () => loadClusters().then(() => toast("集群列表已刷新")).catch((error) => toast(error.message));
$("createClusterBtn").onclick = () => createCluster().catch((error) => toast(error.message));
$("clusterSelect").onchange = () => {
  state.selectedClusterId = $("clusterSelect").value;
  renderClusterTab();
};
$("saveClusterBtn").onclick = () => saveCluster().catch((error) => toast(error.message));
$("deleteClusterBtn").onclick = () => deleteCluster().catch((error) => toast(error.message));
$("addClusterMemberBtn").onclick = () => addClusterMember().catch((error) => toast(error.message));
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
$("deleteInstanceBtn").onclick = async () => {
  if (!state.current) return;
  $("deleteDialogText").textContent = `确定删除实例“${state.current.name}”吗？默认只删除面板实例记录。`;
  $("deleteDataCheck").checked = false;
  $("deleteDialog").classList.remove("hidden");
};
$("cancelDeleteBtn").onclick = () => $("deleteDialog").classList.add("hidden");
$("confirmDeleteBtn").onclick = async () => {
  if (!state.current) return;
  const deleteData = $("deleteDataCheck").checked;
  await api(`/api/instances/${encodeURIComponent(state.current.id)}?deleteData=${deleteData ? "true" : "false"}`, { method: "DELETE" });
  $("deleteDialog").classList.add("hidden");
  state.current = null;
  $("detailView").classList.add("hidden");
  $("emptyState").classList.remove("hidden");
  toast(deleteData ? "实例及实例数据目录已删除" : "实例记录已删除");
  await loadAll();
};
$("loadRawBtn").onclick = async () => {
  await loadRawIni(true);
};
$("rawFileSelect").onchange = () => loadRawIni(true).catch((error) => toast(error.message));
$("saveRawBtn").onclick = async () => {
  const file = $("rawFileSelect").value;
  await api(`/api/instances/${encodeURIComponent(state.current.id)}/ini/${encodeURIComponent(file)}`, {
    method: "PUT",
    body: JSON.stringify({ content: $("rawIniText").value }),
  });
  toast("原始 INI 已保存");
  await loadRawIni(false);
};
$("loadLogsBtn").onclick = async () => {
  const data = await api(`/api/instances/${encodeURIComponent(state.current.id)}/logs`);
  $("logsBox").textContent = data.log || "暂无日志";
};

async function copyText(value, message) {
  await navigator.clipboard.writeText(value);
  toast(message);
}

loadAll().catch((error) => toast(error.message));
