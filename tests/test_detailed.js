/**
 * 详细错误测试 - 查看具体API错误信息
 */

import axios from "axios";

const BASE_URL = "https://open.feishu.cn/open-apis";
const APP_ID = "cli_a9e9d88712f89cc6";
const APP_SECRET = "w8HAy4GB7JnHyrJY4OvuLf6d3M07UeAX";

let tokenCache = { token: null, expiry: 0 };

async function getTenantAccessToken() {
  const now = Date.now() / 1000;
  if (tokenCache.token && now < tokenCache.expiry) {
    return tokenCache.token;
  }

  const response = await axios.post(
    `${BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      app_id: APP_ID,
      app_secret: APP_SECRET,
    }
  );

  tokenCache = {
    token: response.data.tenant_access_token,
    expiry: now + response.data.expire - 60,
  };

  return tokenCache.token;
}

async function testWithErrorHandling(method, path, data = null, queryParams = null) {
  const token = await getTenantAccessToken();
  const config = {
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (data) config.data = data;
  if (queryParams) config.params = queryParams;

  try {
    const response = await axios(config);
    return { success: true, data: response.data };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      status: e.response?.status,
      data: e.response?.data,
    };
  }
}

async function runDetailedTests() {
  console.log("\n========================================");
  console.log("  详细错误诊断测试");
  console.log("========================================\n");

  // 1. Wiki 创建
  console.log("【1. 创建 Wiki 空间】");
  const wikiResult = await testWithErrorHandling("POST", "/wiki/v2/spaces", {
    name: `测试空间_${Date.now()}`,
    description: "测试描述",
  });
  console.log(JSON.stringify(wikiResult, null, 2));

  // 2. 文件搜索
  console.log("\n【2. 搜索文件】");
  const searchResult = await testWithErrorHandling(
    "POST",
    "/drive/v1/files/search",
    { query: "" },
    { page_size: 10 }
  );
  console.log(JSON.stringify(searchResult, null, 2));

  // 3. 日历事件
  console.log("\n【3. 列出日历事件】");
  const calendarResult = await testWithErrorHandling(
    "GET",
    "/calendar/v4/calendars/feishu.cn_primary_calendar/events",
    null,
    { page_size: 10 }
  );
  console.log(JSON.stringify(calendarResult, null, 2));

  // 4. 创建文档
  console.log("\n【4. 创建文档（在根目录）】");
  const docResult = await testWithErrorHandling("POST", "/docx/v1/documents", {
    title: `测试文档_${Date.now()}`,
  });
  console.log(JSON.stringify(docResult, null, 2));

  console.log("\n========================================\n");
}

runDetailedTests().catch(console.error);
