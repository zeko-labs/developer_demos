FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY apps ./apps
COPY data/private-datasets.json ./data/private-datasets.json
COPY docs ./docs
COPY examples ./examples
COPY packages ./packages
COPY schemas ./schemas
COPY scripts ./scripts
COPY README.md ./

ENV HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

CMD ["npm", "start"]
