#!/usr/bin/env node

/**
 * 飞书自动授权脚本
 *
 * 功能：
 * 1. 自动打开浏览器并访问飞书授权页面
 * 2. 等待用户完成登录和授权
 * 3. 自动捕获授权码并交换 token
 * 4. 保存 token 到文件
 * 5. 支持自动刷新机制
 */

import puppeteer from 'puppeteer';
import http from 'http';
import url from 'url';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "https://open.feishu.cn/open-apis";
const PORT = 3000;

// 从环境变量读取配置
const APP_ID = process.env.FEISHU_APP_ID || "cli_a9e9d88712f89cc6";
const APP_SECRET = process.env.FEISHU_APP_SECRET || "w8HAy4GB7JnHyrJY4OvuLf6d3M07UeAX";
const TOKEN_FILE = path.join(__dirname, "user_token.json");
const SESSION_FILE = path.join(__dirname, ".auth_session.json");

/**
 * 生成授权 URL
 */
function getAuthUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `http://localhost:${PORT}/callback`;

  const authUrl = `https://open.feishu.cn/open-apis/authen/v1/index?` +
    `app_id=${encodeURIComponent(APP_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`;

  return { authUrl, state, redirectUri };
}

/**
 * 保存 session（用于下次自动登录）
 */
function saveSession(sessionData) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessionData, null, 2));
  console.error("✓ Session 已保存，下次可自动登录");
}

/**
 * 加载 session（如果存在）
 */
function loadSession() {
  if (fs.existsSync(SESSION_FILE)) {
    try {
      const data = fs.readFileSync(SESSION_FILE, 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
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

/**
 * 自动授权主函数
 */
async function autoAuth(options = {}) {
  const {
    headless = false,      // 是否无头模式（首次建议 false）
    autoLogin = true,      // 是否尝试自动登录
    timeout = 300000,      // 超时时间（5分钟）
  } = options;

  let browser = null;

  try {
    // 1. 启动浏览器
    console.error("========================================");
    console.error("  飞书自动授权");
    console.error("========================================\n");

    console.error("启动浏览器...");
    // 安全的浏览器配置
    browser = await puppeteer.launch({
      headless: headless ? 'new' : false,  // 使用新的 headless 模式
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',  // 仅用于 OAuth 回调
        '--disable-features=VizDisplayCompositor',
      ],
      defaultViewport: {
        width: 1280,
        height: 800,
      },
      ignoreDefaultArgs: ['--disable-extensions'],  // 移除有安全隐患的默认参数
      // 禁用不必要的功能以提高安全性
      ignoreHTTPSErrors: false,  // 不要忽略 HTTPS 错误
    });

    const page = await browser.newPage();

    // 设置用户代理
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // 2. 尝试加载 session（自动登录）
    let savedSession = null;
    if (autoLogin) {
      savedSession = loadSession();
      if (savedSession && savedSession.cookies) {
        console.error("发现保存的 session，尝试自动登录...");
        // 使用 Puppeteer 的 setCookie 方法恢复 cookies
        try {
          await page.setCookie(...savedSession.cookies);
          console.error("✓ Session cookies 已恢复");
        } catch (e) {
          console.error("⚠ 恢复 cookies 失败:", e.message);
        }
      }
    }

    // 3. 启动本地 HTTP 服务器接收回调
    let authServer = null;
    const authPromise = new Promise((resolve, reject) => {
      authServer = http.createServer((req, res) => {
        const parsedUrl = url.parse(req.url, true);

        // CORS 头
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(200);
          res.end();
          return;
        }

        // 回调处理
        if (parsedUrl.pathname === '/callback') {
          const { code, state, error } = parsedUrl.query;

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

          if (error) {
            res.end(`
              <html>
              <head><title>授权失败</title><meta charset="UTF-8"></head>
              <body style="font-family: sans-serif; text-align: center; padding: 50px; background: #fee;">
                <h1 style="color: #c33;">❌ 授权失败</h1>
                <p>错误: ${error}</p>
              </body>
              </html>
            `);
            reject(new Error(error));
            return;
          }

          if (!code) {
            res.end(`
              <html>
              <head><title>参数错误</title><meta charset="UTF-8"></head>
              <body>
                <h1>缺少授权码参数</h1>
              </body>
              </html>
            `);
            reject(new Error("缺少授权码"));
            return;
          }

          // 成功获取授权码
          resolve({ code, state });

          res.end(`
            <html>
            <head><title>处理中...</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ 授权成功！</h1>
              <p>正在交换 Token，请稍候...</p>
              <p>您可以关闭此页面</p>
            </body>
            </html>
          `);
        } else {
          res.writeHead(404);
          res.end('404 Not Found');
        }
      });

      authServer.listen(PORT, () => {
        console.error(`✓ 回调服务器已启动: http://localhost:${PORT}/callback\n`);
      });

      // 超时处理
      setTimeout(() => {
        authServer.close();
        reject(new Error("授权超时"));
      }, timeout);
    });

    // 4. 访问授权页面
    const { authUrl } = getAuthUrl();
    console.error("打开授权页面...");
    console.error("授权 URL:", authUrl, "\n");

    await page.goto(authUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });

    console.error("========================================");
    console.error("  请在浏览器中完成以下操作:");
    console.error("========================================\n");
    console.error("1. 输入飞书账号密码登录");
    console.error("2. 点击「同意授权」按钮");
    console.error("3. 等待自动跳转完成\n");
    console.error("提示: 首次需要手动登录，后续可自动登录");
    console.error("========================================\n");

    // 5. 监听页面变化（自动点击授权按钮）
    const autoClickAuth = async () => {
      try {
        // 等待授权按钮出现
        await page.waitForSelector('button[type="submit"], .auth-button, [class*="auth"] button', {
          timeout: 60000,
        });

        console.error("检测到授权按钮，3秒后自动点击...");
        await new Promise(resolve => setTimeout(resolve, 3000));

        await page.click('button[type="submit"], .auth-button, [class*="auth"] button');
        console.error("✓ 已自动点击授权按钮");
      } catch (e) {
        // 可能已经跳转或不需要点击
        console.error("未找到授权按钮或已自动跳转");
      }
    };

    // 启动自动点击
    autoClickAuth().catch(() => {});

    // 6. 等待授权完成
    const { code } = await authPromise;
    authServer.close();

    console.error("\n✓ 授权成功！获取到授权码");

    // 7. 交换 token
    const now = Date.now() / 1000;
    const tokenData = await exchangeCodeForToken(code);
    const userInfo = await getUserInfo(tokenData.access_token);

    const expiresAt = now + tokenData.expires_in;

    // 8. 保存 token
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

    // 9. 保存 session（用于下次自动登录）
    const cookies = await page.cookies();
    saveSession({
      cookies: cookies,
      saved_at: new Date().toISOString(),
    });

    console.error("\n========================================");
    console.error("  ✓ 自动授权完成！");
    console.error("========================================\n");
    console.error(`用户: ${userInfo.name}`);
    console.error(`Email: ${userInfo.email || "未设置"}`);
    console.error(`Token 有效期: ${Math.floor(tokenData.expires_in / 60)} 分钟`);
    console.error(`Refresh Token 有效期: 约 30 天\n`);

    console.error("下次运行时将尝试自动登录！");
    console.error("========================================\n");

    return {
      success: true,
      user: userInfo,
      expires_at: new Date(expiresAt * 1000).toISOString(),
    };

  } catch (error) {
    console.error("\n✗ 自动授权失败:", error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * 检查并刷新 token（如果需要）
 */
async function checkAndRefreshToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    console.error("未找到 token 文件，需要重新授权");
    return false;
  }

  const tokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const now = Date.now() / 1000;
  const remainingTime = tokenData.expires_at - now;

  // access_token 还有 1 小时以上，不需要刷新
  if (remainingTime > 3600) {
    console.error(`Token 状态正常，剩余 ${Math.floor(remainingTime / 60)} 分钟`);
    return true;
  }

  // access_token 即将过期或已过期，尝试刷新
  if (remainingTime < 300) {
    console.error("Token 即将过期，尝试刷新...");

    try {
      const response = await axios.post(
        `${BASE_URL}/authen/v1/oidc/refresh_access_token`,
        {
          app_id: APP_ID,
          app_secret: APP_SECRET,
          grant_type: "refresh_token",
          refresh_token: tokenData.refresh_token,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        }
      );

      if (response.data.code !== 0) {
        throw new Error(`刷新失败: ${response.data.msg}`);
      }

      const newTokenData = response.data.data;
      const expiresAt = now + newTokenData.expires_in;

      // 更新文件
      const updatedData = {
        ...tokenData,
        access_token: newTokenData.access_token,
        refresh_token: newTokenData.refresh_token || tokenData.refresh_token,
        expires_at: expiresAt,
        saved_at: new Date().toISOString(),
      };
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(updatedData, null, 2));

      console.error("✓ Token 刷新成功");
      console.error(`新有效期至: ${new Date(expiresAt * 1000).toLocaleString()}`);
      return true;

    } catch (error) {
      console.error("✗ Token 刷新失败:", error.message);
      console.error("需要重新授权");
      return false;
    }
  }

  return true;
}

// ==================== 命令行入口 ====================

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  try {
    if (command === 'check') {
      // 检查并刷新 token
      const success = await checkAndRefreshToken();
      process.exit(success ? 0 : 1);

    } else if (command === 'auto') {
      // 自动授权
      const options = {
        headless: args.includes('--headless'),
        autoLogin: !args.includes('--no-auto-login'),
      };
      await autoAuth(options);

    } else if (command === 'help' || !command) {
      // 帮助信息
      console.error(`
========================================
  飞书自动授权脚本
========================================

用法:
  node auto_auth.js [命令] [选项]

命令:
  auto        运行自动授权（默认）
  check       检查并刷新 token
  help        显示帮助信息

选项:
  --headless         无头模式（不显示浏览器）
  --no-auto-login    不使用自动登录

示例:
  node auto_auth.js auto           # 运行自动授权
  node auto_auth.js auto --headless # 无头模式
  node auto_auth.js check          # 检查 token 状态

========================================
      `);

    } else {
      console.error("未知命令:", command);
      console.error("使用 'node auto_auth.js help' 查看帮助");
      process.exit(1);
    }

  } catch (error) {
    console.error("执行失败:", error.message);
    process.exit(1);
  }
}

main();
