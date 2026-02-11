-/**
- * Node.js VLESS Server - Ultimate Edition
- * 特性：UUID 严格校验 + 路径分流 + 极客风伪装面板
- */
-
 const http = require('http');
-const net = require('net');
 const { WebSocketServer } = require('ws');
-const { TextDecoder } = require('util');
-
-// --- 1. 配置加载 (优先读取环境变量) ---
-const PORT = process.env.PORT || 7860; // HF 内部固定端口
-const UUID = process.env.UUID || "00000000-0000-0000-0000-000000000000"; // 默认 UUID，请务必在环境变量修改
-const PROXY_IP = process.env.PROXYIP || ""; // 想要转发到的优选 IP (可选)
-const WS_PATH = process.env.WS_PATH || "/api/v1/stream"; // 关键：WS 路径
 
-// 预处理 UUID：去除横杠，转为小写，用于后续校验
-const VALID_UUID_HEX = UUID.replace(/-/g, '').toLowerCase();
+const PORT = Number(process.env.PORT || 7860);
+const WS_PATH = process.env.WS_PATH || '/ws';
 
-console.log(`[System] Server starting on port ${PORT}`);
-console.log(`[System] Protected Path: ${WS_PATH}`);
-console.log(`[System] UUID Validation: Enabled`);
-
-// --- 2. 伪装内容 (极客风监控面板) ---
-const DASHBOARD_HTML = `
-<!DOCTYPE html>
-<html lang="en">
+const html = `<!doctype html>
+<html lang="zh-CN">
 <head>
-    <meta charset="UTF-8">
-    <meta name="viewport" content="width=device-width, initial-scale=1.0">
-    <title>Server Status | Matrix Node</title>
-    <style>
-        body { background: #000; color: #0f0; font-family: 'Courier New', Courier, monospace; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; height: 100vh; overflow: hidden; }
-        .monitor { border: 1px solid #333; padding: 40px; width: 600px; box-shadow: 0 0 15px rgba(0, 255, 0, 0.2); background: #0a0a0a; }
-        h1 { border-bottom: 1px solid #333; padding-bottom: 10px; margin-top: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; }
-        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
-        .label { color: #666; font-size: 12px; }
-        .value { font-size: 16px; font-weight: bold; }
-        .log { margin-top: 30px; height: 150px; overflow: hidden; font-size: 12px; color: #555; border-top: 1px solid #222; padding-top: 10px; }
-        .blink { animation: blink 1s infinite; }
-        @keyframes blink { 50% { opacity: 0; } }
-    </style>
+  <meta charset="UTF-8" />
+  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
+  <title>HF Space WebSocket Demo</title>
+  <style>
+    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 30px auto; padding: 0 16px; }
+    h1 { margin-bottom: 4px; }
+    .muted { color: #666; margin-top: 0; }
+    #log { border: 1px solid #ddd; border-radius: 8px; min-height: 180px; padding: 12px; white-space: pre-wrap; }
+    .row { display: flex; gap: 8px; margin-top: 12px; }
+    input { flex: 1; padding: 8px; }
+    button { padding: 8px 12px; cursor: pointer; }
+  </style>
 </head>
 <body>
-    <div class="monitor">
-        <h1>System Interface</h1>
-        <div class="grid">
-            <div><div class="label">STATUS</div><div class="value">ONLINE</div></div>
-            <div><div class="label">UPTIME</div><div class="value" id="uptime">00:00:00</div></div>
-            <div><div class="label">LOAD</div><div class="value">0.12, 0.08, 0.04</div></div>
-            <div><div class="label">MEMORY</div><div class="value">256MB / 2048MB</div></div>
-        </div>
-        <div class="log" id="log">
-            > Initializing protocols...<br>
-            > Loading kernel modules...<br>
-            > Connection established.<br>
-            > Waiting for data stream... <span class="blink">_</span>
-        </div>
-    </div>
-    <script>
-        let s = 0;
-        setInterval(() => {
-            s++;
-            const h = Math.floor(s/3600).toString().padStart(2,'0');
-            const m = Math.floor((s%3600)/60).toString().padStart(2,'0');
-            const sec = (s%60).toString().padStart(2,'0');
-            document.getElementById('uptime').innerText = \`\${h}:\${m}:\${sec}\`;
-        }, 1000);
-    </script>
-</body>
-</html>
-`;
-
-// --- 3. VLESS 协议解析与校验 ---
-function parseAndValidateVless(buffer) {
-    if (buffer.length < 24) return { error: "Data too short" };
-    
-    const version = buffer[0];
-    
-    // [关键步骤] 提取并校验 UUID
-    const requestUuidBytes = buffer.subarray(1, 17);
-    const requestUuidHex = requestUuidBytes.toString('hex');
-    
-    // 如果 UUID 不匹配，返回错误
-    if (requestUuidHex !== VALID_UUID_HEX) {
-        return { error: `Invalid UUID. Got: ${requestUuidHex}` };
+  <h1>WebSocket 实时演示</h1>
+  <p class="muted">这是一个合规的实时消息示例（非代理服务），用于 Hugging Face Spaces Docker 部署。</p>
+  <div id="log"></div>
+  <div class="row">
+    <input id="msg" placeholder="输入消息后发送" />
+    <button id="send">发送</button>
+  </div>
+  <script>
+    const log = document.getElementById('log');
+    const msg = document.getElementById('msg');
+    const send = document.getElementById('send');
+    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WS_PATH}');
+
+    function append(line) {
+      log.textContent += line + '\n';
+      log.scrollTop = log.scrollHeight;
     }
 
-    const optLen = buffer[17];
-    const cmd = buffer[18 + optLen];
-    
-    if (cmd !== 1) return { error: `Unsupported CMD: ${cmd} (TCP only)` };
-
-    const portIdx = 19 + optLen;
-    const port = (buffer[portIdx] << 8) | buffer[portIdx + 1];
-    
-    const addrIdx = portIdx + 2;
-    const addrType = buffer[addrIdx];
-    let hostname = "";
-    let rawIndex = 0;
-
-    if (addrType === 1) { // IPv4
-        hostname = buffer.subarray(addrIdx + 1, addrIdx + 5).join(".");
-        rawIndex = addrIdx + 5;
-    } else if (addrType === 2) { // Domain
-        const len = buffer[addrIdx + 1];
-        hostname = new TextDecoder().decode(buffer.subarray(addrIdx + 2, addrIdx + 2 + len));
-        rawIndex = addrIdx + 2 + len;
-    } else {
-        return { error: `Unknown address type: ${addrType}` };
-    }
+    ws.addEventListener('open', () => append('✅ 已连接到服务器'));
+    ws.addEventListener('message', (e) => append('📩 收到: ' + e.data));
+    ws.addEventListener('close', () => append('🔌 连接已关闭'));
 
-    return { error: null, port, hostname, rawIndex, version };
-}
-
-// --- 4. WebSocket 处理 ---
-function handleConnection(ws) {
-    let isAuth = false;
-    let remote = null;
-
-    ws.on('message', (msg) => {
-        // 如果已经建立了远程连接，直接转发数据
-        if (remote) {
-            if (!remote.destroyed && remote.writable) remote.write(msg);
-            return;
-        }
-
-        // 如果还没验证，尝试解析 VLESS 头
-        if (!isAuth) {
-            const buffer = Buffer.from(msg);
-            const result = parseAndValidateVless(buffer);
-
-            if (result.error) {
-                console.error(`[Auth Failed] ${result.error}`);
-                ws.close(); // 验证失败，直接断开
-                return;
-            }
-
-            isAuth = true;
-            const targetHost = PROXY_IP || result.hostname;
-            const targetPort = result.port;
-
-            // console.log(`[Connect] ${targetHost}:${targetPort}`); // 调试用，生产环境可注释
-
-            remote = net.createConnection(targetPort, targetHost, () => {
-                // 连接成功，返回响应头
-                const header = Buffer.alloc(2);
-                header[0] = result.version;
-                header[1] = 0;
-                ws.send(header);
-
-                // 发送剩余数据
-                if (buffer.length > result.rawIndex) {
-                    remote.write(buffer.subarray(result.rawIndex));
-                }
-            });
-
-            remote.on('data', d => { if (ws.readyState === ws.OPEN) ws.send(d); });
-            remote.on('error', () => ws.close());
-            remote.on('close', () => ws.close());
-        }
+    send.addEventListener('click', () => {
+      if (!msg.value) return;
+      ws.send(msg.value);
+      append('⬆️ 已发送: ' + msg.value);
+      msg.value = '';
     });
+  </script>
+</body>
+</html>`;
 
-    ws.on('close', () => { if (remote) remote.destroy(); });
-    ws.on('error', () => { if (remote) remote.destroy(); });
-}
-
-// --- 5. HTTP 服务器 (流量入口) ---
 const server = http.createServer((req, res) => {
-    // 除了 WS 路径外，其他所有访问都返回伪装页面或 404
-    if (req.url === '/') {
-        res.writeHead(200, { 'Content-Type': 'text/html' });
-        res.end(DASHBOARD_HTML);
-    } else {
-        // 伪装成 API 错误
-        res.writeHead(404, { 'Content-Type': 'application/json' });
-        res.end(JSON.stringify({ code: 404, message: "Resource not found", timestamp: Date.now() }));
-    }
+  if (req.url === '/') {
+    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
+    res.end(html);
+    return;
+  }
+
+  if (req.url === '/healthz') {
+    res.writeHead(200, { 'content-type': 'application/json' });
+    res.end(JSON.stringify({ ok: true }));
+    return;
+  }
+
+  res.writeHead(404, { 'content-type': 'application/json' });
+  res.end(JSON.stringify({ error: 'Not Found' }));
 });
 
-// --- 6. 协议升级 (WS 握手) ---
 const wss = new WebSocketServer({ noServer: true });
 
-server.on('upgrade', (request, socket, head) => {
-    // 路径强校验：只有路径完全匹配 WS_PATH 才允许升级
-    if (request.url !== WS_PATH) {
-        socket.destroy();
-        return;
-    }
+wss.on('connection', (ws) => {
+  ws.send('欢迎使用 HF Space WebSocket Demo');
 
-    wss.handleUpgrade(request, socket, head, (ws) => {
-        wss.emit('connection', ws, request);
-    });
+  ws.on('message', (message) => {
+    const text = message.toString();
+
+    // 仅做演示：回显并广播在线人数。
+    ws.send(`服务器回显: ${text}`);
+
+    const online = wss.clients.size;
+    for (const client of wss.clients) {
+      if (client.readyState === 1) {
+        client.send(`当前在线连接: ${online}`);
+      }
+    }
+  });
 });
 
-wss.on('connection', (ws) => {
-    handleConnection(ws);
+server.on('upgrade', (req, socket, head) => {
+  if (req.url !== WS_PATH) {
+    socket.destroy();
+    return;
+  }
+
+  wss.handleUpgrade(req, socket, head, (ws) => {
+    wss.emit('connection', ws, req);
+  });
 });
 
-server.listen(PORT, () => {
-    console.log(`Listening on ${PORT}`);
+server.listen(PORT, '0.0.0.0', () => {
+  console.log(`Server listening on :${PORT}`);
+  console.log(`WebSocket endpoint: ${WS_PATH}`);
 });
