#!/bin/sh
# bootstrap-npm-docker.sh
# ----------------------------------------------------------------------------
# 给「只装了 node、没有 npm/npx/corepack」的精简容器补上 npm + npx。
# 纯 node + curl + tar 实现，不依赖 apt/apk（精简镜像通常也没有包管理器）。
#
# 背景：部分 Yunzai Docker 镜像只带了 /usr/bin/node，没有 npx。
# 于是本插件 MCP 配置里的 command: "npx" 会启动失败：
#     spawn 失败：ENOENT spawn npx   /   旧版表现为 request timeout: initialize
# 跑本脚本装好 npm/npx 后，原 MCP 配置无需改动即可工作。
#
# 用法（在宿主机执行，<容器> 换成你的 Yunzai 容器名，如 TRSS_AllBot）：
#     docker cp plugins/agents-plugin/scripts/bootstrap-npm-docker.sh <容器>:/tmp/bs.sh
#     docker exec <容器> sh /tmp/bs.sh
#
# 注意：本脚本装在「运行中的容器」里；容器一旦重建（重新 docker run）会丢失，
#       需重跑；想一劳永逸请把它加进镜像的 entrypoint / Dockerfile。
# ----------------------------------------------------------------------------

set -e

NODE_BIN="${NODE_BIN:-$(command -v node 2>/dev/null || echo /usr/bin/node)}"
NPM_PREFIX="${NPM_PREFIX:-/opt/npm}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"   # 需在容器 PATH 中且可写（一般 root 用户即可）

echo "[1/5] 检查 node：$NODE_BIN ($("$NODE_BIN" -v 2>/dev/null || echo '?'))"

echo "[2/5] 准备目录 $NPM_PREFIX"
mkdir -p "$NPM_PREFIX"
cd "$NPM_PREFIX"

echo "[3/5] 解析 npm 最新版 tarball 并下载解压（npm 自带依赖，node 直接可跑）"
TARBALL=$(curl -s https://registry.npmjs.org/npm/latest \
  | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).dist.tarball)})')
echo "    tarball = $TARBALL"
curl -sL "$TARBALL" | tar xz

echo "[4/5] 写入 $BIN_DIR/{npm,npx} 包装脚本"
cat > "$BIN_DIR/npm" <<EOF
#!/bin/sh
exec $NODE_BIN $NPM_PREFIX/package/bin/npm-cli.js "\$@"
EOF
cat > "$BIN_DIR/npx" <<EOF
#!/bin/sh
exec $NODE_BIN $NPM_PREFIX/package/bin/npx-cli.js "\$@"
EOF
chmod +x "$BIN_DIR/npm" "$BIN_DIR/npx"

echo "[5/5] 验证"
echo "    npm -> $(npm --version)"
echo "    npx -> $(npx --version)"
echo "完成。现在 MCP 配置里的 command: \"npx\" 可以正常工作了。"
