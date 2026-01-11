#!/usr/bin/env node

/**
 * 认证诊断测试脚本
 */

import fs from "fs";
import path from "path";
import axios from "axios";

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "cli_a9e9d88712f89cc6";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "w8HAy4GB7JnHyrJY4OvuLf6d3M07UeAX";
const BASE_URL = "https://open.feishu.cn";
const USER_TOKEN_FILE = path.join(process.cwd(), "user_token.json");

console.log("========================================");
console.log("  飞书认证诊断测试");
console.log("========================================\n");

// 1. 检查环境变量
console.log("1. 检查环境配置:");
console.log(`   App ID: ${FEISHU_APP_ID}`);
console.log(`   App Secret: ${FEISHU_APP_SECRET.substring(0, 10)}...`);

// 2. 检查 token 文件
console.log("\n2. 检查用户 Token 文件:");
if (fs.existsSync(USER_TOKEN_FILE)) {
  const tokenData = JSON.parse(fs.readFileSync(USER_TOKEN_FILE, "utf8"));
  const now = Date.now() / 1000;
  const expiresIn = Math.floor(tokenData.expires_at - now);

  console.log(`   ✓ Token 文件存在`);
  console.log(`   Access Token: ${tokenData.access_token.substring(0, 20)}...`);
  console.log(`   过期时间: ${expiresIn > 0 ? expiresIn + " 秒后" : "已过期"}`);
  console.log(`   用户: ${tokenData.user?.name || "未知"}`);

  // 3. 测试 token 是否有效
  console.log("\n3. 测试 Token 有效性:");
  testUserToken(tokenData.access_token);
} else {
  console.log(`   ✗ Token 文件不存在: ${USER_TOKEN_FILE}`);
  console.log(`   请先运行认证服务器完成授权:`);
  console.log(`     node auth_server.js`);
}

async function testUserToken(token) {
  try {
    // 使用正确的用户信息 API
    const response = await axios.get(`${BASE_URL}/open-apis/authen/v1/user_info`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (response.data.code === 0) {
      console.log(`   ✓ Token 有效`);
      console.log(`   用户: ${response.data.data.name}`);
    }
  } catch (error) {
    if (error.response?.status === 401) {
      console.log(`   ✗ Token 无效或已过期`);
    } else {
      console.log(`   ✗ 请求失败: ${error.message}`);
    }
  }
}

// 4. 测试 tenant_access_token
console.log("\n4. 测试应用 Token:");
testAppToken();

async function testAppToken() {
  try {
    const response = await axios.post(
      `${BASE_URL}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
      },
      {
        headers: { "Content-Type": "application/json" },
      }
    );

    if (response.data.code === 0) {
      console.log(`   ✓ 应用 Token 获取成功`);
      const tenantToken = response.data.tenant_access_token;

      // 测试 Wiki 列表接口
      console.log("\n5. 测试 Wiki 列表接口:");
      await testWikiList(tenantToken);
    } else {
      console.log(`   ✗ 应用 Token 获取失败: ${response.data.msg}`);
    }
  } catch (error) {
    console.log(`   ✗ 请求失败: ${error.message}`);
  }
}

async function testWikiList(token) {
  try {
    const response = await axios.get(`${BASE_URL}/open-apis/wiki/v2/spaces`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (response.data.code === 0) {
      console.log(`   ✓ Wiki 列表获取成功，共 ${response.data.data.items.length} 个知识库`);
    } else {
      console.log(`   ✗ API 错误: ${response.data.msg}`);
    }
  } catch (error) {
    console.log(`   ✗ 请求失败: ${error.message}`);
  }
}
