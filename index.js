/**
 * Node.js VLESS Server (VLESS over WebSocket)
 * 适配云平台 (Render/Koyeb/Fly.io 等)
 */

const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');
const { TextDecoder } = require('util');

// --- 1. 全局配置 ---
const PORT = process.env.PORT || 8000;
const UUID = process.env.UUID || "a2056d0d-c98e-4aeb-9aab-37f64edd5710";
const PROXY_IP = process.env.PROXYIP || ""; // 想要转发的优选IP (可选)
const SUB_PATH = process.env.SUB_PATH || "sub"; // 订阅路径

console.log(`Node.js VLESS Server Running on port ${PORT}...`);
console.log(`UUID: ${UUID}`);

// --- 2. 核心逻辑函数 ---

/**
 * 解析 VLESS 协议头部
 */
function parseVlessHeader(buffer) {
    if (buffer.length < 24) {
        return { hasError: true, msg: "Data too short" };
    }
    
    const version = buffer[0];
    const optLen = buffer[17];
    const cmd = buffer[18 + optLen]; // 1=TCP, 2=UDP

    if (cmd !== 1) {
        return { hasError: true, msg: `Unsupported CMD: ${cmd} (Only TCP)` };
    }

    const portIdx = 19 + optLen;
    const port = (buffer[portIdx] << 8) | buffer[portIdx + 1];

    let addrIdx = portIdx + 2;
    const addrType = buffer[addrIdx];
    let hostname = "";
    let rawIndex = 0;

    if (addrType === 1) { // IPv4
        hostname = buffer.subarray(addrIdx + 1, addrIdx + 5).join(".");
        rawIndex = addrIdx + 5;
    } else if (addrType === 2) { // Domain
        const len = buffer[addrIdx + 1];
        hostname = new TextDecoder().decode(buffer.subarray(addrIdx + 2, addrIdx + 2 + len));
        rawIndex = addrIdx + 2 + len;
    } else if (addrType === 3) { // IPv6
        // Node.js 简化处理，不支持 IPv6 避免报错
        return { hasError: true, msg: "IPv6 not supported in this lite version" };
    } else {
        return { hasError: true, msg: `Unknown address type: ${addrType}` };
    }

    return { hasError: false, port, hostname, rawIndex, version };
}

/**
 * 处理 WebSocket 连接
 */
function handleVlessConnection(ws) {
    let isHeaderParsed = false;
    let remoteConnection = null;

    ws.on('message', (msg) => {
        const chunk = Buffer.from(msg);

        // 1. 已连接状态：直接转发
        if (remoteConnection) {
            if (!remoteConnection.destroyed && remoteConnection.writable) {
                remoteConnection.write(chunk);
            }
            return;
        }

        // 2. 未连接状态：解析头部并连接
        if (!isHeaderParsed) {
            const res = parseVlessHeader(chunk);
            if (res.hasError) {
                console.error(`[Header Error] ${res.msg}`);
                ws.close();
                return;
            }

            isHeaderParsed = true;
            // 优选 IP 逻辑
            const targetHost = PROXY_IP || res.hostname;
            const targetPort = res.port;

            console.log(`[Connecting] ${res.hostname}:${res.port} -> ${targetHost}`);

            // 建立 TCP 连接
            remoteConnection = net.createConnection(targetPort, targetHost, () => {
                // 连接成功，发送 VLESS 响应头 (Version + 0)
                const header = Buffer.alloc(2);
                header[0] = res.version;
                header[1] = 0;
                ws.send(header);

                // 如果 payload 还有剩余数据，一并发送
                if (chunk.length > res.rawIndex) {
                    remoteConnection.write(chunk.subarray(res.rawIndex));
                }
            });

            // 绑定远程 socket 事件
            remoteConnection.on('data', (data) => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(data);
                }
            });

            remoteConnection.on('error', (err) => {
                console.error(`[Remote Error] ${targetHost}:${targetPort} - ${err.message}`);
                ws.close();
            });

            remoteConnection.on('close', () => ws.close());
            remoteConnection.on('timeout', () => {
                remoteConnection.destroy();
                ws.close();
            });
        }
    });

    ws.on('close', () => {
        if (remoteConnection) remoteConnection.destroy();
    });

    ws.on('error', (err) => {
        console.error(`[WS Error] ${err.message}`);
        if (remoteConnection) remoteConnection.destroy();
    });
}

// --- 3. 启动 HTTP Server ---

const server = http.createServer((req, res) => {
    // 构造 URL 对象
    const baseURL = 'http://' + (req.headers.host || 'localhost');
    const url = new URL(req.url, baseURL);

    // 情况 A: 获取订阅链接
    if (url.pathname === `/${SUB_PATH}`) {
        const host = req.headers.host;
        
        // --- 关键修改：强制输出为 443 端口 + TLS ---
        // 即使 Node 在本地监听 8000，我们也假设外网是通过 HTTPS (443) 访问的
        const publicPort = 443;
        const security = "tls"; 
        
        // 生成 V2RayN 格式的订阅链接
        const vlessLink = `vless://${UUID}@${host}:${publicPort}?encryption=none&security=${security}&type=ws&host=${host}&path=%2F#Node-${host.split('.')[0]}`;
        
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(Buffer.from(vlessLink).toString('base64'));
        return;
    }

    // 情况 B: 默认响应
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Node.js VLESS Server is Running.\nUUID: ${UUID}`);
});

// --- 4. 绑定 WebSocket Server ---

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // 可以在这里加路径判断
    // if (request.url !== '/') { socket.destroy(); return; }

    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

wss.on('connection', (ws) => {
    handleVlessConnection(ws);
});

server.listen(PORT, () => {
    console.log(`Listening on port ${PORT}`);
});
