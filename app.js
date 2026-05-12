const state = {
  datasets: [
    {
      id: crypto.randomUUID(),
      name: "coco8",
      train: "datasets/coco8/images/train",
      val: "datasets/coco8/images/val",
      nc: 80,
      classes: ["person", "car", "dog", "..."],
    },
  ],
  editingDatasetId: null,
  modules: [],
  training: {
    running: false,
    timer: null,
    epoch: 0,
    totalEpochs: 0,
    loss: [],
    map50: [],
  },
};

const $ = (id) => document.getElementById(id);
const logBox = $("train-log");
const progressBar = $("train-progress");
const commandBox = $("training-command");
const esc = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");

function appendLog(msg) {
  const now = new Date().toLocaleTimeString();
  logBox.textContent += `[${now}] ${msg}\n`;
  logBox.scrollTop = logBox.scrollHeight;
}

function renderDatasetTable() {
  const body = $("dataset-body");
  body.innerHTML = "";
  for (const dataset of state.datasets) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${esc(dataset.name)}</td>
      <td>${esc(dataset.train)}</td>
      <td>${esc(dataset.val)}</td>
      <td>${esc(dataset.nc)}</td>
      <td>${esc(dataset.classes.join(", "))}</td>
      <td>
        <button data-action="edit" data-id="${dataset.id}">编辑</button>
        <button data-action="delete" data-id="${dataset.id}" class="secondary">删除</button>
      </td>`;
    body.appendChild(tr);
  }
}

$("dataset-body").addEventListener("click", (e) => {
  const button = e.target.closest("button");
  if (!button) return;
  const id = button.dataset.id;
  const action = button.dataset.action;
  const dataset = state.datasets.find((d) => d.id === id);
  if (!dataset) return;

  if (action === "delete") {
    state.datasets = state.datasets.filter((d) => d.id !== id);
    if (state.editingDatasetId === id) state.editingDatasetId = null;
    renderDatasetTable();
    appendLog(`已删除数据集 ${dataset.name}`);
    return;
  }

  state.editingDatasetId = id;
  $("dataset-name").value = dataset.name;
  $("dataset-path").value = dataset.train;
  $("dataset-val").value = dataset.val;
  $("dataset-nc").value = dataset.nc;
  $("dataset-classes").value = dataset.classes.join(",");
});

$("dataset-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const payload = {
    name: $("dataset-name").value.trim(),
    train: $("dataset-path").value.trim(),
    val: $("dataset-val").value.trim(),
    nc: Number($("dataset-nc").value),
    classes: $("dataset-classes").value.split(",").map((v) => v.trim()).filter(Boolean),
  };

  if (!payload.name || !payload.train || !payload.val || payload.nc < 1 || payload.classes.length < 1) {
    appendLog("数据集字段不完整，保存失败");
    return;
  }

  if (state.editingDatasetId) {
    const i = state.datasets.findIndex((d) => d.id === state.editingDatasetId);
    if (i >= 0) {
      state.datasets[i] = { ...state.datasets[i], ...payload };
      appendLog(`已更新数据集 ${payload.name}`);
    }
    state.editingDatasetId = null;
  } else {
    state.datasets.push({ ...payload, id: crypto.randomUUID() });
    appendLog(`已新增数据集 ${payload.name}`);
  }

  e.target.reset();
  $("dataset-nc").value = "1";
  renderDatasetTable();
});

function splitTopLevel(content) {
  const out = [];
  let buf = "";
  let depth = 0;
  for (const ch of content) {
    if (ch === "[") depth += 1;
    if (ch === "]") depth -= 1;
    if (ch === "," && depth === 0) {
      out.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

function parseYaml() {
  const input = $("yaml-input").value;
  const rows = input.split("\n");
  const modules = [];
  for (const row of rows) {
    const trimmed = row.trim();
    if (!trimmed.startsWith("- [")) continue;
    const noDash = trimmed.slice(2).trim();
    const [listPart, comment = ""] = noDash.split("#");
    const content = listPart.trim().replace(/^\[/, "").replace(/\]$/, "");
    const [from, repeat, module, ...rest] = splitTopLevel(content);
    const args = rest.join(",").trim();
    const inMatch = comment.match(/in=([^\s]+)/);
    const outMatch = comment.match(/out=([^\s]+)/);
    const outputShape = outMatch ? outMatch[1] : modules.at(-1)?.outputShape || "unknown";
    modules.push({
      from: from || "-1",
      repeat: Number(repeat) || 1,
      module: (module || "Custom").trim(),
      args: args || "[]",
      inputShape: inMatch ? inMatch[1] : modules.at(-1)?.outputShape || "unknown",
      outputShape,
    });
  }
  state.modules = modules;
  renderModules();
}

function renderModules() {
  const body = $("module-table");
  body.innerHTML = "";
  state.modules.forEach((mod, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index}</td>
      <td>${esc(mod.module)}</td>
      <td>${esc(mod.from)}</td>
      <td>${esc(mod.repeat)}</td>
      <td>${esc(mod.args)}</td>
      <td>${esc(mod.inputShape)}</td>
      <td>${esc(mod.outputShape)}</td>
      <td>
        <button data-select-module="${index}">编辑</button>
        <button data-move-up="${index}" class="secondary">上移</button>
        <button data-move-down="${index}" class="secondary">下移</button>
      </td>`;
    body.appendChild(tr);
  });
  renderGraph();
}

$("module-table").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const select = btn.dataset.selectModule;
  const up = btn.dataset.moveUp;
  const down = btn.dataset.moveDown;

  if (select !== undefined) {
    loadModule(Number(select));
    return;
  }

  if (up !== undefined) {
    const i = Number(up);
    if (i > 0) {
      [state.modules[i - 1], state.modules[i]] = [state.modules[i], state.modules[i - 1]];
      renderModules();
    }
    return;
  }

  if (down !== undefined) {
    const i = Number(down);
    if (i < state.modules.length - 1) {
      [state.modules[i + 1], state.modules[i]] = [state.modules[i], state.modules[i + 1]];
      renderModules();
    }
  }
});

function loadModule(i) {
  const mod = state.modules[i];
  if (!mod) return;
  $("mod-index").value = i;
  $("mod-from").value = mod.from;
  $("mod-repeat").value = mod.repeat;
  $("mod-name").value = mod.module;
  $("mod-args").value = mod.args;
  $("mod-in").value = mod.inputShape;
  $("mod-out").value = mod.outputShape;
}

$("add-module").addEventListener("click", () => {
  state.modules.push({
    from: "-1",
    repeat: 1,
    module: "CustomBlock",
    args: "[128, 3]",
    inputShape: state.modules.at(-1)?.outputShape || "unknown",
    outputShape: "unknown",
  });
  renderModules();
  loadModule(state.modules.length - 1);
});

$("module-editor").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = Number($("mod-index").value);
  if (!Number.isInteger(i) || i < 0 || i >= state.modules.length) {
    appendLog("请先选择有效模块索引");
    return;
  }

  state.modules[i] = {
    from: $("mod-from").value.trim(),
    repeat: Number($("mod-repeat").value) || 1,
    module: $("mod-name").value.trim() || "CustomBlock",
    args: $("mod-args").value.trim() || "[]",
    inputShape: $("mod-in").value.trim() || "unknown",
    outputShape: $("mod-out").value.trim() || "unknown",
  };

  renderModules();
  appendLog(`模块 ${i} 已更新`);
});

$("delete-module").addEventListener("click", () => {
  const i = Number($("mod-index").value);
  if (!Number.isInteger(i) || i < 0 || i >= state.modules.length) return;
  state.modules.splice(i, 1);
  renderModules();
  appendLog(`模块 ${i} 已删除`);
});

function drawLine(ctx, values, color, maxY) {
  if (!values.length) return;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const xStep = w / Math.max(values.length - 1, 1);
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = i * xStep;
    const y = h - (v / maxY) * (h - 20) - 10;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function renderMetrics() {
  const canvas = $("metrics-canvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const maxLoss = Math.max(...state.training.loss, 1);
  drawLine(ctx, state.training.loss, "#dc2626", maxLoss);
  drawLine(ctx, state.training.map50, "#2563eb", 1);

  ctx.fillStyle = "#dc2626";
  ctx.fillText("loss", 8, 14);
  ctx.fillStyle = "#2563eb";
  ctx.fillText("mAP50", 52, 14);
}

function startTraining() {
  if (state.training.running) return;

  const cfg = {
    model: $("model").value,
    device: $("device").value,
    epochs: Math.max(1, Number($("epochs").value) || 1),
    batch: Math.max(1, Number($("batch").value) || 1),
    imgsz: Math.max(64, Number($("imgsz").value) || 640),
    lr0: Number($("lr0").value) || 0.01,
    optimizer: $("optimizer").value,
    data: $("data").value.trim(),
  };

  state.training.running = true;
  state.training.epoch = 0;
  state.training.totalEpochs = cfg.epochs;
  state.training.loss = [];
  state.training.map50 = [];

  $("start-training").disabled = true;
  $("stop-training").disabled = false;
  logBox.textContent = "";

  commandBox.textContent = `yolo task=detect mode=train model=${cfg.model} data=${cfg.data} epochs=${cfg.epochs} imgsz=${cfg.imgsz} batch=${cfg.batch} optimizer=${cfg.optimizer} lr0=${cfg.lr0} device=${cfg.device}`;
  appendLog("训练已启动");

  state.training.timer = setInterval(() => {
    state.training.epoch += 1;
    const p = state.training.epoch / state.training.totalEpochs;
    const loss = Math.max(0.05, 1.9 * (1 - p) + Math.random() * 0.1);
    const map = Math.min(0.9, 0.1 + p * 0.8 + Math.random() * 0.03);
    state.training.loss.push(Number(loss.toFixed(3)));
    state.training.map50.push(Number(map.toFixed(3)));
    progressBar.style.width = `${(p * 100).toFixed(1)}%`;
    appendLog(`epoch ${state.training.epoch}/${state.training.totalEpochs} - loss=${loss.toFixed(3)} mAP50=${map.toFixed(3)}`);
    renderMetrics();

    if (state.training.epoch >= state.training.totalEpochs) {
      stopTraining(true);
    }
  }, 120);
}

function stopTraining(done = false) {
  if (state.training.timer) {
    clearInterval(state.training.timer);
    state.training.timer = null;
  }
  state.training.running = false;
  $("start-training").disabled = false;
  $("stop-training").disabled = true;
  appendLog(done ? "训练完成" : "训练已停止");
}

function renderGraph() {
  const svg = $("graph");
  const ns = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";

  if (!state.modules.length) return;

  const cardW = 180;
  const cardH = 56;
  const gap = 36;
  const startX = 40;
  const y = 34;

  state.modules.forEach((m, i) => {
    const x = startX + i * (cardW + gap);

    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", String(x));
    rect.setAttribute("y", String(y));
    rect.setAttribute("rx", "8");
    rect.setAttribute("ry", "8");
    rect.setAttribute("width", String(cardW));
    rect.setAttribute("height", String(cardH));
    rect.setAttribute("fill", "#dbeafe");
    rect.setAttribute("stroke", "#2563eb");
    svg.appendChild(rect);

    const name = document.createElementNS(ns, "text");
    name.setAttribute("x", String(x + 10));
    name.setAttribute("y", String(y + 20));
    name.textContent = `${i}. ${m.module}`;
    name.setAttribute("fill", "#1e3a8a");
    name.setAttribute("font-size", "12");
    svg.appendChild(name);

    const shape = document.createElementNS(ns, "text");
    shape.setAttribute("x", String(x + 10));
    shape.setAttribute("y", String(y + 40));
    shape.textContent = `${m.inputShape} → ${m.outputShape}`;
    shape.setAttribute("fill", "#334155");
    shape.setAttribute("font-size", "11");
    svg.appendChild(shape);

    if (i < state.modules.length - 1) {
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", String(x + cardW));
      line.setAttribute("y1", String(y + cardH / 2));
      line.setAttribute("x2", String(x + cardW + gap - 8));
      line.setAttribute("y2", String(y + cardH / 2));
      line.setAttribute("stroke", "#0f172a");
      line.setAttribute("stroke-width", "2");
      svg.appendChild(line);
    }
  });

  const width = startX + state.modules.length * (cardW + gap);
  svg.setAttribute("viewBox", `0 0 ${Math.max(width, 760)} 160`);
}

$("start-training").addEventListener("click", startTraining);
$("stop-training").addEventListener("click", () => stopTraining(false));
$("parse-yaml").addEventListener("click", () => {
  parseYaml();
  appendLog(`已解析 ${state.modules.length} 个网络模块`);
});

parseYaml();
renderDatasetTable();
renderMetrics();
appendLog("界面已就绪，可开始配置与实验");
