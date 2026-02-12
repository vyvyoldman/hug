FROM node:18-alpine

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmjs.org/
ENV NPM_CONFIG_REGISTRY=${NPM_REGISTRY}

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=${NPM_REGISTRY}

COPY index.js ./

RUN chown -R node:node /app
USER node

EXPOSE 7860
CMD ["node", "index.js"]
