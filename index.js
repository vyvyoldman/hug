/**
 * Node.js VLESS Server for Hugging Face
 * 包含：伪装网页 + 路径分流
 */

const http = require('http');
const net = require('net');
const { WebSocketServer } = require('ws');
const { TextDecoder } = require('util');

// --- 1. 全局配置 ---
// HF 默认端口是 7860
const PORT = process.env.PORT || 7860; 
const UUID = process.env.UUID || "a2056d0d-c98e-4aeb-9aab-37f64edd5710";
const PROXY_IP = process.env.PROXYIP || ""; 

// *** 关键修改：定义 WS 路径，不要用根路径 ***
// 客户端的 path 必须填写这个，例如 /my-vless-path
const WS_PATH = process.env.WS_PATH || "/vl-ws"; 

// 伪装的 HTML 页面内容 (可以是任何看起来正常的页面)
const FAKE_HTML = `
<!DOCTYPE html>
<html>
<head>
    <title>Welcome to AI Demo</title>
    <style>
        body { font-family: sans-serif; text-align: center; padding: 50px; background: #f0f0f0; }
        h1 { color: #333; }
        p { color: #666; }
    </style>
</head>
<body>
    <h1>AI Model Inference API</h1>
    <p>Status: System Operational</p>
    <p>Version: 2.0.5</p>
    <hr>
    <p>Unauthorized access is prohibited.</p>
</body>
</html>
`;

console.log(`Server Running on port ${PORT}`);
console.log(`UUID: ${UUID}`);
console.log(`WS Path: ${WS_PATH}`);

// --- 2. VLESS 核心逻辑 (保持不变) ---
function parseVlessHeader(buffer) {
    if (buffer.length < 24) return { hasError: true, msg: "Data too short" };
    const version = buffer[0];
    const optLen = buffer[17];
    const cmd = buffer[18 + optLen]; 
    if (cmd !== 1) return { hasError: true, msg: `Unsupported CMD: ${cmd}` };
    
    const portIdx = 19 + optLen;
    const port = (buffer[portIdx] << 8) | buffer[portIdx + 1];
    let addrIdx = portIdx + 2;
    const addrType = buffer[addrIdx];
    let hostname = "";
    let rawIndex = 0;

    if (addrType === 1) { 
        hostname = buffer.subarray(addrIdx + 1, addrIdx + 5).join(".");
        rawIndex = addrIdx + 5;
    } else if (addrType === 2) { 
        const len = buffer[addrIdx + 1];
        hostname = new TextDecoder().decode(buffer.subarray(addrIdx + 2, addrIdx + 2 + len));
        rawIndex = addrIdx + 2 + len;
    } else {
        return { hasError: true, msg: `Unknown address type: ${addrType}` };
    }
    return { hasError: false, port, hostname, rawIndex, version };
}

function handleVlessConnection(ws) {
    let isHeaderParsed = false;
    let remoteConnection = null;
    ws.on('message', (msg) => {
        const chunk = Buffer.from(msg);
        if (remoteConnection) {
            if (!remoteConnection.destroyed && remoteConnection.writable) {
                remoteConnection.write(chunk);
            }
            return;
        }
        if (!isHeaderParsed) {
            const res = parseVlessHeader(chunk);
            if (res.hasError) {
                console.error(`[Header Error] ${res.msg}`);
                ws.close();
                return;
            }
            isHeaderParsed = true;
            const targetHost = PROXY_IP || res.hostname;
            const targetPort = res.port;
            
            remoteConnection = net.createConnection(targetPort, targetHost, () => {
                const header = Buffer.alloc(2);
                header[0] = res.version;
                header[1] = 0;
                ws.send(header);
                if (chunk.length > res.rawIndex) {
                    remoteConnection.write(chunk.subarray(res.rawIndex));
                }
            });
            remoteConnection.on('data', (data) => {
                if (ws.readyState === ws.OPEN) ws.send(data);
            });
            remoteConnection.on('error', () => ws.close());
            remoteConnection.on('close', () => ws.close());
        }
    });
    ws.on('close', () => { if (remoteConnection) remoteConnection.destroy(); });
    ws.on('error', () => { if (remoteConnection) remoteConnection.destroy(); });
}

// --- 3. HTTP Server (伪装 + 分流) ---
const server = http.createServer((req, res) => {
    // 任何 HTTP 请求都返回伪装页面
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(FAKE_HTML);
});

// --- 4. WebSocket Upgrade (只处理特定路径) ---
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    // *** 关键：路径检查 ***
    // 如果路径不是环境变量中定义的 WS_PATH，直接销毁连接
    if (request.url !== WS_PATH) {
        socket.destroy();
        return;
    }

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
