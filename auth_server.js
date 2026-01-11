#!/usr/bin/env node

/**
 * 飞书用户认证服务器
 * 支持回调模式和手动输入授权码模式
 */

import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import axios from "axios";

const BASE_URL = "https://open.feishu.cn/open-apis";
const PORT = 3000;

// 从环境变量读取配置
const APP_ID = process.env.FEISHU_APP_ID || "cli_a9e9d88712f89cc6";
const APP_SECRET = process.env.FEISHU_APP_SECRET || "w8HAy4GB7JnHyrJY4OvuLf6d3M07UeAX";

// Token 存储文件
const TOKEN_FILE = path.join(process.cwd(), "user_token.json");

// 生成状态码
function generateState() {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * 生成授权 URL
 * 使用 redirect_uri 参数
 */
function getAuthUrl() {
  const state = generateState();
  const redirectUri = "http://localhost:3000/callback";

  // 不指定 scope，让飞书自动显示所有已配置的权限
  const authUrl = `https://open.feishu.cn/open-apis/authen/v1/index?` +
    `app_id=${encodeURIComponent(APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { authUrl, state, redirectUri };
}

/**
 * 保存 token 到文件
 */
function saveToken(tokenData) {
  const data = {
    ...tokenData,
    saved_at: new Date().toISOString(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2));
  console.error("✓ Token 已保存到:", TOKEN_FILE);
}

/**
 * 使用授权码获取 token
 * 使用两步流程：先获取 app_access_token，再用它交换用户 token
 */
async function exchangeCodeForToken(code) {
  // 步骤 1: 获取 app_access_token
  console.error("步骤 1: 获取 app_access_token...");
  const appTokenResponse = await axios.post(
    `${BASE_URL}/auth/v3/app_access_token/internal`,
    {
      app_id: APP_ID,
      app_secret: APP_SECRET,
    },
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  console.error("App Token 响应:", JSON.stringify(appTokenResponse.data, null, 2));

  if (appTokenResponse.data.code !== 0) {
    throw new Error(`获取 app_access_token 失败: ${appTokenResponse.data.msg}`);
  }

  const appAccessToken = appTokenResponse.data.app_access_token;

  // 步骤 2: 使用 app_access_token 交换用户 token
  console.error("步骤 2: 使用 app_access_token 交换用户 token...");
  const response = await axios.post(
    `${BASE_URL}/authen/v1/oidc/access_token`,
    {
      app_access_token: appAccessToken,
      grant_type: "authorization_code",
      code: code,
    },
    {
      headers: { "Content-Type": "application/json" },
    }
  );

  console.error("User Token 响应:", JSON.stringify(response.data, null, 2));

  if (response.data.code !== 0) {
    throw new Error(`错误码 ${response.data.code}: ${response.data.msg || "获取 token 失败"}`);
  }

  return response.data.data;
}

/**
 * 获取用户信息
 */
async function getUserInfo(accessToken) {
  const response = await axios.get(
    `${BASE_URL}/authen/v1/user_info`,
    {
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    }
  );

  if (response.data.code !== 0) {
    throw new Error(response.data.msg || "获取用户信息失败");
  }

  return response.data.data;
}

// 存储 state 验证
const stateStore = new Map();

// HTTP 服务器
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS 头
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // 主页
  if (parsedUrl.pathname === "/") {
    const { authUrl, state } = getAuthUrl();
    stateStore.set(state, Date.now());

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <html>
      <head>
        <title>飞书用户认证</title>
        <meta charset="UTF-8">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            max-width: 700px;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            padding: 50px;
            text-align: center;
          }
          h1 {
            color: #333;
            margin: 0 0 10px;
            font-size: 32px;
          }
          .subtitle {
            color: #666;
            margin: 0 0 30px;
            font-size: 16px;
          }
          .steps {
            text-align: left;
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin: 30px 0;
          }
          .steps h3 {
            color: #333;
            margin: 0 0 15px;
            font-size: 18px;
          }
          .steps ol {
            margin: 0;
            padding-left: 20px;
          }
          .steps li {
            color: #555;
            line-height: 1.8;
            margin: 8px 0;
          }
          .steps code {
            background: #e9ecef;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 14px;
          }
          .btn {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            text-decoration: none;
            padding: 15px 40px;
            border-radius: 50px;
            font-size: 18px;
            font-weight: 600;
            margin: 20px 10px;
            transition: transform 0.2s, box-shadow 0.2s;
          }
          .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
          }
          .status {
            margin: 20px 0;
            padding: 15px;
            border-radius: 10px;
            font-size: 14px;
          }
          .status.success {
            background: #d4edda;
            color: #155724;
          }
          .status.error {
            background: #f8d7da;
            color: #721c24;
          }
          .status.info {
            background: #d1ecf1;
            color: #0c5460;
          }
          .token-info {
            text-align: left;
            background: #f8f9fa;
            border-radius: 12px;
            padding: 20px;
            margin: 20px 0;
            font-size: 14px;
          }
          .token-info p {
            margin: 8px 0;
            color: #555;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 飞书用户认证</h1>
          <p class="subtitle">授权 Claude Code 访问您的飞书账号</p>

          <div class="steps">
            <h3>📋 授权步骤</h3>
            <ol>
              <li>点击下方按钮打开飞书授权页面</li>
              <li>在飞书页面点击「同意授权」</li>
              <li>系统将自动跳转回本页面完成授权</li>
            </ol>
          </div>

          <div id="status" class="status info">
            💡 点击下方按钮开始授权流程
          </div>

          <a href="${authUrl}" class="btn">打开授权页面</a>

          <div class="steps">
            <h3>⚠️ 如果看到错误码 20029</h3>
            <p>请按以下步骤配置飞书应用：</p>
            <ol>
              <li>访问 <a href="https://open.feishu.cn/app" target="_blank">飞书开放平台</a></li>
              <li>选择应用: <code>cli_a9e9d88712f89cc6</code></li>
              <li>进入「权限管理」→「安全设置」</li>
              <li>添加重定向 URL: <code>http://localhost:3000/callback</code></li>
              <li>保存后重新点击授权按钮</li>
            </ol>
          </div>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // 回调处理
  if (parsedUrl.pathname === "/callback") {
    const { code, state, error } = parsedUrl.query;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });

    if (error) {
      res.end(`
        <html>
        <head>
          <title>授权失败</title>
          <meta charset="UTF-8">
          <style>
            body { font-family: sans-serif; text-align: center; padding: 50px; background: #fee; }
            h1 { color: #c33; }
          </style>
        </head>
        <body>
          <h1>❌ 授权失败</h1>
          <p>错误: ${error}</p>
          <a href="/">返回</a>
        </body>
        </html>
      `);
      return;
    }

    if (!code) {
      res.end(`
        <html>
        <head>
          <title>参数错误</title>
          <meta charset="UTF-8">
        </head>
        <body>
          <h1>缺少授权码参数</h1>
          <a href="/">返回</a>
        </body>
        </html>
      `);
      return;
    }

    // 验证 state
    if (!stateStore.has(state)) {
      res.end(`
        <html>
        <head>
          <title>验证失败</title>
          <meta charset="UTF-8">
        </head>
        <body>
          <h1>State 验证失败</h1>
          <a href="/">返回重试</a>
        </body>
        </html>
      `);
      return;
    }
    stateStore.delete(state);

    // 交换 token
    try {
      const tokenData = await exchangeCodeForToken(code);
      const userInfo = await getUserInfo(tokenData.access_token);

      // 计算过期时间
      const expiresAt = Date.now() / 1000 + tokenData.expires_in;

      // 保存 token
      saveToken({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: expiresAt,
        expires_in: tokenData.expires_in,
        user: {
          name: userInfo.name,
          en_name: userInfo.en_name,
          email: userInfo.email,
          user_id: userInfo.user_id,
          avatar_url: userInfo.avatar_url,
        },
      });

      res.end(`
        <html>
        <head>
          <title>授权成功</title>
          <meta charset="UTF-8">
          <style>
            body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; }
            .success { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 500px; margin: 0 auto; }
            h1 { color: #28a745; }
            p { color: #555; margin: 10px 0; }
            .info { background: #f8f9fa; padding: 15px; border-radius: 10px; margin: 20px 0; text-align: left; }
            .info p { margin: 5px 0; }
          </style>
        </head>
        <body>
          <div class="success">
            <h1>✅ 授权成功!</h1>
            <div class="info">
              <p><strong>用户:</strong> ${userInfo.name}</p>
              <p><strong>Email:</strong> ${userInfo.email || "未设置"}</p>
              <p><strong>Token 有效期:</strong> ${Math.floor(tokenData.expires_in / 60)} 分钟</p>
            </div>
            <p>现在可以关闭此页面并使用 Claude Code 了</p>
            <p><a href="/">返回首页</a></p>
          </div>
        </body>
        </html>
      `);

      console.error("\\n✓ 用户认证成功!");
      console.error(`  用户: ${userInfo.name}`);
      console.error(`  Email: ${userInfo.email || "未设置"}`);
      console.error(`  User ID: ${userInfo.user_id}\\n`);

    } catch (error) {
      console.error("交换 token 失败:", error.message);
      if (error.response?.data) {
        console.error("API 错误:", JSON.stringify(error.response.data, null, 2));
      }

      res.end(`
        <html>
        <head>
          <title>Token 获取失败</title>
          <meta charset="UTF-8">
          <style>
            body { font-family: sans-serif; text-align: center; padding: 50px; }
            h1 { color: #c33; }
            .error { background: #fee; padding: 20px; border-radius: 10px; margin: 20px; }
          </style>
        </head>
        <body>
          <h1>❌ Token 获取失败</h1>
          <div class="error">
            <p>${error.message}</p>
            ${error.response?.data ? `<p>API 错误: ${JSON.stringify(error.response.data)}</p>` : ""}
          </div>
          <p>请检查授权码是否正确，或返回重试</p>
          <a href="/">返回重试</a>
        </body>
        </html>
      `);
    }
    return;
  }

  // Token 状态查询
  if (parsedUrl.pathname === "/token") {
    const tokenData = loadToken();
    const now = Date.now() / 1000;

    if (!tokenData) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        exists: false,
        valid: null,
        expires_in: 0,
        user: null,
      }));
      return;
    }

    const expiresIn = Math.floor(tokenData.expires_at - now);

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      exists: true,
      valid: expiresIn > 0,
      expires_in: expiresIn,
      user: tokenData.user,
    }));
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404 Not Found");
});

// 启动服务器
server.listen(PORT, () => {
  console.error("========================================");
  console.error("  飞书用户认证服务器");
  console.error("========================================\\n");

  console.error("✓ 服务器已启动: http://localhost:" + PORT);
  console.error("✓ 应用 ID: " + APP_ID);
  console.error("✓ 回调地址: http://localhost:" + PORT + "/callback\\n");

  console.error("========================================");
  console.error("  重要提示");
  console.error("========================================\\n");

  console.error("如果看到错误码 20029 (redirect_uri 不合法)，请:");
  console.error("1. 访问: https://open.feishu.cn/app");
  console.error("2. 找到应用: cli_a9e9d88712f89cc6");
  console.error("3. 进入「权限管理」→「安全设置」");
  console.error("4. 添加重定向 URL: http://localhost:3000/callback");
  console.error("5. 保存后刷新页面重试\\n");

  console.error("========================================");
  console.error("  授权步骤");
  console.error("========================================\\n");

  console.error("1. 在浏览器打开: http://localhost:" + PORT);
  console.error("2. 点击「打开授权页面」按钮");
  console.error("3. 在飞书页面点击「同意授权」");
  console.error("4. 自动跳转回来完成认证\\n");

  console.error("========================================\\n");
});
