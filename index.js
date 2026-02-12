const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 7860);
const WS_PATH = process.env.WS_PATH || '/ws';

const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HF Space WebSocket Demo</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 760px; margin: 30px auto; padding: 0 16px; }
    h1 { margin-bottom: 4px; }
    .muted { color: #666; margin-top: 0; }
    #log { border: 1px solid #ddd; border-radius: 8px; min-height: 180px; padding: 12px; white-space: pre-wrap; }
    .row { display: flex; gap: 8px; margin-top: 12px; }
    input { flex: 1; padding: 8px; }
    button { padding: 8px 12px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>WebSocket 实时演示</h1>
  <p class="muted">只保留 WebSocket 功能：连接、发送、回显与在线数广播。</p>
  <div id="log"></div>
  <div class="row">
    <input id="msg" placeholder="输入消息后发送" />
    <button id="send">发送</button>
  </div>
  <script>
    const log = document.getElementById('log');
    const msg = document.getElementById('msg');
    const send = document.getElementById('send');
    const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '${WS_PATH}');

    function append(line) {
      log.textContent += line + '\n';
      log.scrollTop = log.scrollHeight;
    }

    ws.addEventListener('open', () => append('✅ 已连接到服务器'));
    ws.addEventListener('message', (e) => append('📩 收到: ' + e.data));
    ws.addEventListener('close', () => append('🔌 连接已关闭'));

    send.addEventListener('click', () => {
      if (!msg.value) return;
      ws.send(msg.value);
      append('⬆️ 已发送: ' + msg.value);
      msg.value = '';
    });
  </script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.send('欢迎使用 HF Space WebSocket Demo');

  ws.on('message', (message) => {
    const text = message.toString();
    ws.send(`服务器回显: ${text}`);

    const online = wss.clients.size;
    for (const client of wss.clients) {
      if (client.readyState === 1) {
        client.send(`当前在线连接: ${online}`);
      }
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url !== WS_PATH) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on :${PORT}`);
  console.log(`WebSocket endpoint: ${WS_PATH}`);
});
