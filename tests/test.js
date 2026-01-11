/**
 * 飞书企业MCP服务器测试脚本
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

  if (response.data.code !== 0) {
    throw new Error(`获取 token 失败: ${response.data.msg}`);
  }

  tokenCache = {
    token: response.data.tenant_access_token,
    expiry: now + response.data.expire - 60,
  };

  return tokenCache.token;
}

async function feishuRequest(method, path, data = null, queryParams = null) {
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

  const response = await axios(config);

  if (response.data.code !== 0) {
    throw new Error(`API 请求失败 [${response.data.code}]: ${response.data.msg}`);
  }

  return response.data;
}

// 测试结果
const testResults = {
  passed: [],
  failed: [],
  skipped: [],
};

function log(name, status, message) {
  const icon = { pass: "✓", fail: "✗", skip: "○" }[status];
  console.log(`${icon} ${name}: ${message}`);
  if (status === "pass") testResults.passed.push({ name, message });
  else if (status === "fail") testResults.failed.push({ name, message });
  else testResults.skipped.push({ name, message });
}

async function testToken() {
  try {
    const token = await getTenantAccessToken();
    log("获取 Tenant Token", "pass", `Token: ${token.substring(0, 20)}...`);
    return token;
  } catch (e) {
    log("获取 Tenant Token", "fail", e.message);
    throw e;
  }
}

async function testAppInfo() {
  try {
    // 尝试获取应用信息（通过token验证）
    const token = await getTenantAccessToken();
    log("应用凭证验证", "pass", "App ID: " + APP_ID);
  } catch (e) {
    log("应用凭证验证", "fail", e.message);
  }
}

async function testListWikiSpaces() {
  try {
    const result = await feishuRequest("GET", "/wiki/v2/spaces", null, {
      page_size: 10,
    });
    const count = result.data.items?.length || 0;
    log("列出 Wiki 空间", "pass", `找到 ${count} 个空间`);
    return result.data.items || [];
  } catch (e) {
    log("列出 Wiki 空间", "fail", e.message);
    return [];
  }
}

async function testGetWikiSpace(spaceId) {
  try {
    const result = await feishuRequest("GET", `/wiki/v2/spaces/${spaceId}`);
    log("获取 Wiki 空间详情", "pass", `空间: ${result.data.space.name}`);
    return result.data.space;
  } catch (e) {
    log("获取 Wiki 空间详情", "fail", e.message);
    return null;
  }
}

async function testCreateWikiSpace() {
  try {
    const timestamp = Date.now();
    const result = await feishuRequest("POST", "/wiki/v2/spaces", {
      name: `测试空间_${timestamp}`,
      description: "这是 MCP 测试自动创建的知识空间",
    });
    log("创建 Wiki 空间", "pass", `空间ID: ${result.data.space.space_id}`);
    return result.data.space;
  } catch (e) {
    log("创建 Wiki 空间", "fail", e.message);
    return null;
  }
}

async function testListWikiNodes(spaceId) {
  try {
    const result = await feishuRequest(
      "GET",
      `/wiki/v2/spaces/${spaceId}/nodes`,
      null,
      { page_size: 50 }
    );
    const count = result.data.items?.length || 0;
    log("列出 Wiki 节点", "pass", `找到 ${count} 个节点`);
    return result.data.items || [];
  } catch (e) {
    log("列出 Wiki 节点", "fail", e.message);
    return [];
  }
}

async function testCreateWikiNode(spaceId) {
  try {
    const result = await feishuRequest(
      "POST",
      `/wiki/v2/spaces/${spaceId}/nodes`,
      {
        title: `测试节点_${Date.now()}`,
        obj_type: "document",
      }
    );
    log("创建 Wiki 节点", "pass", `节点token: ${result.data.node.node_token}`);
    return result.data.node;
  } catch (e) {
    log("创建 Wiki 节点", "fail", e.message);
    return null;
  }
}

async function testListFiles() {
  try {
    const result = await feishuRequest("POST", "/drive/v1/files/search", {
      query: "",
    }, {
      page_size: 10,
    });
    const count = result.data.items?.length || 0;
    log("列出文件", "pass", `找到 ${count} 个文件`);
    return result.data.items || [];
  } catch (e) {
    log("列出文件", "fail", e.message);
    return [];
  }
}

async function testCreateDocument() {
  // 获取一个文件夹token
  try {
    const files = await testListFiles();
    const folder = files.find((f) => f.type === "folder");

    if (!folder) {
      log("创建文档", "skip", "没有找到文件夹");
      return null;
    }

    const result = await feishuRequest("POST", "/docx/v1/documents", {
      folder_token: folder.token,
      title: `测试文档_${Date.now()}`,
    });

    log("创建文档", "pass", `文档ID: ${result.data.document.document_id}`);
    return result.data.document;
  } catch (e) {
    log("创建文档", "fail", e.message);
    return null;
  }
}

async function testGetDocumentContent(documentId) {
  if (!documentId) {
    log("获取文档内容", "skip", "没有文档ID");
    return null;
  }
  try {
    const result = await feishuRequest(
      "GET",
      `/docx/v1/documents/${documentId}/blocks`,
      null,
      { page_size: 10 }
    );
    const blockCount = result.data.items?.length || 0;
    log("获取文档内容", "pass", `文档块数量: ${blockCount}`);
    return result.data;
  } catch (e) {
    log("获取文档内容", "fail", e.message);
    return null;
  }
}

async function testCreateBitable() {
  try {
    const files = await testListFiles();
    const folder = files.find((f) => f.type === "folder");

    const result = await feishuRequest("POST", "/bitable/v1/apps", {
      folder_token: folder?.token || "",
      name: `测试表格_${Date.now()}`,
    });

    log("创建多维表格", "pass", `表格token: ${result.data.app.app_token}`);
    return result.data.app;
  } catch (e) {
    log("创建多维表格", "fail", e.message);
    return null;
  }
}

async function testGetBitableRecords(appToken) {
  if (!appToken) {
    log("获取表格记录", "skip", "没有表格token");
    return null;
  }
  try {
    // 先获取表格列表
    const tablesResult = await feishuRequest(
      "GET",
      `/bitable/v1/apps/${appToken}/tables`
    );

    if (!tablesResult.data.items || tablesResult.data.items.length === 0) {
      log("获取表格记录", "skip", "表格没有数据表");
      return null;
    }

    const tableId = tablesResult.data.items[0].table_id;

    const result = await feishuRequest(
      "GET",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      null,
      { page_size: 10 }
    );

    const count = result.data.items?.length || 0;
    log("获取表格记录", "pass", `记录数量: ${count}`);
    return result.data;
  } catch (e) {
    log("获取表格记录", "fail", e.message);
    return null;
  }
}

async function testCreateBitableRecord(appToken) {
  if (!appToken) {
    log("创建表格记录", "skip", "没有表格token");
    return null;
  }
  try {
    const tablesResult = await feishuRequest(
      "GET",
      `/bitable/v1/apps/${appToken}/tables`
    );

    if (!tablesResult.data.items || tablesResult.data.items.length === 0) {
      log("创建表格记录", "skip", "表格没有数据表");
      return null;
    }

    const tableId = tablesResult.data.items[0].table_id;

    const result = await feishuRequest(
      "POST",
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      { fields: {} }
    );

    log("创建表格记录", "pass", `记录ID: ${result.data.record.record_id}`);
    return result.data.record;
  } catch (e) {
    log("创建表格记录", "fail", e.message);
    return null;
  }
}

async function testListCalendarEvents() {
  try {
    const result = await feishuRequest(
      "GET",
      "/calendar/v4/calendars/feishu.cn_primary_calendar/events",
      null,
      { page_size: 10 }
    );

    const count = result.data.items?.length || 0;
    log("列出日历事件", "pass", `事件数量: ${count}`);
    return result.data;
  } catch (e) {
    log("列出日历事件", "fail", e.message);
    return null;
  }
}

async function runAllTests() {
  console.log("\n========================================");
  console.log("  飞书企业 MCP 服务器功能测试");
  console.log("========================================\n");

  console.log("【基础】\n");
  await testToken();
  await testAppInfo();

  console.log("\n【Wiki 知识库】\n");
  await testListWikiSpaces();
  const spaces = await testListWikiSpaces();

  let testSpaceId = null;
  for (const space of spaces) {
    await testGetWikiSpace(space.space_id);
    await testListWikiNodes(space.space_id);
  }

  const newSpace = await testCreateWikiSpace();
  if (newSpace) {
    testSpaceId = newSpace.space_id;
    await testListWikiNodes(testSpaceId);
    await testCreateWikiNode(testSpaceId);
  }

  console.log("\n【文档操作】\n");
  await testListFiles();
  const newDoc = await testCreateDocument();
  if (newDoc) {
    await testGetDocumentContent(newDoc.document_id);
  }

  console.log("\n【多维表格】\n");
  const newTable = await testCreateBitable();
  if (newTable) {
    await testGetBitableRecords(newTable.app_token);
    await testCreateBitableRecord(newTable.app_token);
  }

  console.log("\n【日历事件】\n");
  await testListCalendarEvents();

  console.log("\n========================================");
  console.log("  测试结果汇总");
  console.log("========================================\n");

  console.log(`✓ 通过: ${testResults.passed.length}`);
  console.log(`✗ 失败: ${testResults.failed.length}`);
  console.log(`○ 跳过: ${testResults.skipped.length}`);

  if (testResults.failed.length > 0) {
    console.log("\n失败详情:\n");
    testResults.failed.forEach((t) => {
      console.log(`  - ${t.name}: ${t.message}`);
    });
  }

  console.log("\n========================================\n");
}

runAllTests().catch(console.error);
