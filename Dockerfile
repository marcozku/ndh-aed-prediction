# 使用 Node.js 官方映像
FROM node:18

# 安裝 Python 3 和 pip
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# 設置工作目錄
WORKDIR /app

# 複製 package.json 和 package-lock.json
COPY package*.json ./

# 安裝 Node.js 依賴
RUN npm install

# 複製 Python requirements
COPY python/requirements.txt python/requirements.txt

# 安裝 Python 依賴
RUN pip3 install --upgrade pip && \
    cd python && \
    pip3 install -r requirements.txt

# 複製所有文件
COPY . .

# 創建模型目錄
RUN mkdir -p python/models

# 暴露端口
EXPOSE 3001

# 啟動應用
CMD ["node", "server.js"]

