const net = require('net');
const http = require('http');
const https = require('https'); // 用于保活请求
const { WebSocket, createWebSocketStream } = require('ws');
const { TextDecoder } = require('util');
const log = console.log;

// --- 1. 配置区域 (环境变量) ---
const UUID = process.env.UUID || '0be2f204-11e3-4d32-88f0-d946d94b484f'; // 务必修改
const PORT = process.env.PORT || 7860;
const DOMAIN = process.env.DOMAIN || ''; // 填写你的域名，例如：app.serv00.com，用于保活
const AUTO_ACCESS = process.env.AUTO_ACCESS || true; // 是否开启自动保活

// --- 2. 伪装网页内容 (Nginx 风格) ---
const PAGE_CONTENT = `
<!DOCTYPE html>
<html>
<head>
<title>Welcome to nginx!</title>
<style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
</style>
</head>
<body>
<h1>Welcome to nginx!</h1>
<p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
<p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
<p><em>Thank you for using nginx.</em></p>
</body>
</html>
`;

// --- 3. 辅助功能：自动保活 (原生 https 实现，免 axios) ---
function keepAlive() {
  if (!AUTO_ACCESS || !DOMAIN) {
    console.log('自动保活未开启或未设置域名，跳过。');
    return;
  }

  // 1. 提交给 serv00 的保活接口 (还原原代码逻辑)
  const postData = JSON.stringify({ url: `https://${DOMAIN}` });
  const options = {
    hostname: 'oooo.serv00.net',
    port: 443,
    path: '/add-url',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': postData.length
    }
  };

  const req = https.request(options, (res) => {
    log(`[保活] Serv00 任务提交状态: ${res.statusCode}`);
  });

  req.on('error', (e) => {
    // console.error(`[保活] 提交失败: ${e.message}`);
  });

  req.write(postData);
  req.end();

  // 2. (可选) 自己每隔一段时间访问一下自己，防止休眠
  // 这里的保活逻辑可以根据需要扩展
}

// --- 4. 核心逻辑：UUID 校验与 VLESS 协议 ---
const uuid = UUID.replace(/-/g, "");

// --- 5. HTTP Server (处理伪装网页) ---
const httpServer = http.createServer((req, res) => {
  // 默认返回伪装网页
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE_CONTENT);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

// --- 6. WebSocket Server (处理 VLESS 流量) ---
const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  ws.once('message', (msg) => {
    const [VERSION] = msg;
    const chunk = Buffer.from(msg);

    // VLESS 协议特征校验: 
    // 1. 数据长度足够
    // 2. 版本号为 0
    // 3. UUID 匹配
    if (chunk.length < 17 || VERSION !== 0) {
      ws.close();
      return;
    }

    const id = chunk.slice(1, 17);
    const isValid = id.every((v, i) => v === parseInt(uuid.substr(i * 2, 2), 16));

    if (!isValid) {
      ws.close();
      return;
    }

    // --- 开始解析 VLESS 头部 ---
    try {
      let i = 17; // UUID 结束位置
      
      // Addons Length (1字节)
      const optLength = chunk.slice(i, i + 1).readUInt8();
      i += (1 + optLength); // 跳过 Addons
      
      // Command (1字节)
      const command = chunk.slice(i, i + 1).readUInt8(); 
      i += 1;
      
      // Port (2字节, Big Endian)
      const port = chunk.slice(i, i + 2).readUInt16BE(0);
      i += 2;
      
      // Address Type (1字节)
      const atyp = chunk.slice(i, i + 1).readUInt8();
      i += 1;
      
      let host = '';
      
      if (atyp === 1) { // IPv4
        host = chunk.slice(i, i + 4).join('.');
        i += 4;
      } else if (atyp === 2) { // Domain
        const hostLen = chunk.slice(i, i + 1).readUInt8();
        i += 1;
        host = new TextDecoder().decode(chunk.slice(i, i + hostLen));
        i += hostLen;
      } else if (atyp === 3) { // IPv6
        host = chunk.slice(i, i + 16).reduce((s, b, i, a) => (i % 2 ? s.concat(a.slice(i - 1, i + 1)) : s), []).map(b => b.readUInt16BE(0).toString(16)).join(':');
        i += 16;
      } else {
        ws.close(); // 不支持的地址类型
        return;
      }

      // --- 发送响应头部 (VLESS Response) ---
      // 格式: [Version, Addons Length] -> [0, 0]
      ws.send(new Uint8Array([0, 0]));

      // --- 建立后端连接 ---
      // 提取实际数据部分 (去掉 VLESS 头部)
      const dataBody = chunk.slice(i);

      // 连接目标服务器
      const remoteSocket = net.connect({ host, port }, () => {
        // 连接成功后，先把首包剩余数据发过去
        if (dataBody.length > 0) {
            remoteSocket.write(dataBody);
        }
        
        // 建立双向流管道
        const wsStream = createWebSocketStream(ws);
        
        // 错误处理，防止崩溃
        wsStream.on('error', () => {});
        remoteSocket.on('error', () => {});

        // 管道转发: WS -> Remote -> WS
        wsStream.pipe(remoteSocket);
        remoteSocket.pipe(wsStream);
        
        log(`[VLESS] 连接成功: ${host}:${port}`);
      });

      remoteSocket.on('error', () => {
        ws.close();
      });

    } catch (e) {
      console.error('VLESS 解析错误', e);
      ws.close();
    }
  });

  ws.on('error', () => {});
});

// --- 7. 启动服务 ---
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`UUID: ${UUID}`);
  
  // 启动时执行一次保活任务
  if (AUTO_ACCESS) {
    keepAlive();
  }
});
