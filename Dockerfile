# 使用轻量级 Node.js 18 Alpine 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 先复制 package.json 以利用缓存
COPY package.json .

# 安装依赖
RUN npm install --production

# 复制主程序代码
COPY index.js .

# --- 关键：权限设置 ---
# Hugging Face 强制要求非 Root 运行，我们赋予 node 用户权限
RUN chown -R node:node /app

# 切换到 node 用户 (UID 1000)
USER node

# 暴露 HF 默认端口
EXPOSE 7860

# 启动命令
CMD ["node", "index.js"]
