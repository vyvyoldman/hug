# 使用轻量级的 Node.js Alpine 镜像
FROM node:alpine

# 设置工作目录
WORKDIR /app

# 复制依赖配置文件
COPY package.json ./

# 安装依赖 (只安装生产环境依赖，减少体积)
RUN npm install --only=production

# 复制核心代码文件
COPY index.js ./

# 设置环境变量默认值 (运行时可覆盖)
# 端口
ENV PORT=7860
# UUID (建议在运行时通过环境变量覆盖，不要硬编码在这里)
ENV UUID=5efabea4-f6d4-91fd-b8f0-17e004c89c60
# 你的域名 (用于自动保活)
ENV DOMAIN=example.com
# 是否开启保活
ENV AUTO_ACCESS=true

# 暴露端口
EXPOSE 7860

# 启动命令
CMD ["node", "index.js"]
