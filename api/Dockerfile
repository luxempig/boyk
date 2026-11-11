FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY index.js ./
# Drop root: the node:alpine image ships an unprivileged `node` user.
USER node
EXPOSE 3001
ENV PORT=3001
CMD ["node", "index.js"]
