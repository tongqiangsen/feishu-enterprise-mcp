#!/usr/bin/env node

/**
 * 飞书企业级 MCP 服务器
 * 支持文档、Wiki、多维表格、消息、日历等飞书企业API
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==================== 配置 ====================
const BASE_URL = "https://open.feishu.cn/open-apis";
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "cli_a9e9d88712f89cc6";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "w8HAy4GB7JnHyrJY4OvuLf6d3M07UeAX";

// Token 缓存
let tokenCache = {
  token: null,
  expiry: 0,
};

// 用户 Token 缓存（增强版）
let userTokenCache = {
  token: null,
  expiry: 0,
  fileModTime: 0,  // 新增：记录文件修改时间
  refreshTimer: null,  // 新增：主动刷新定时器
};

/**
 * 清理用户 Token 缓存（防止内存泄漏）
 * 在服务器关闭或 Token 失效时调用
 */
function clearUserTokenCache() {
  if (userTokenCache.refreshTimer) {
    clearTimeout(userTokenCache.refreshTimer);
    userTokenCache.refreshTimer = null;
  }
  userTokenCache.token = null;
  userTokenCache.expiry = 0;
  userTokenCache.fileModTime = 0;
}

// Token 文件路径
const USER_TOKEN_FILE = path.join(__dirname, "user_token.json");

// Token 刷新提前时间（秒）- 提前5分钟刷新
const TOKEN_REFRESH_ADVANCE = 300;

// Token 健康检查间隔（秒）- 每30秒检查一次
// 注意：这只是读本地文件，不会调用飞书API
// 只有在token即将过期时才会调用刷新API
const TOKEN_HEALTH_CHECK_INTERVAL = 30;

// 智能检查模式：动态调整检查频率
const SMART_CHECK_MODE = true;
const CHECK_INTERVALS = {
  NORMAL: 30,      // 正常情况：30秒
  URGENT: 10,      // 紧急情况（即将过期）：10秒
  LONG_IDLE: 300,  // 长时间无活动：5分钟
};

// Token 刷新重试次数
const TOKEN_REFRESH_RETRY_COUNT = 3;

// Token 刷新重试延迟（毫秒）
const TOKEN_REFRESH_RETRY_DELAY = 1000;

// ==================== 安全配置 ====================

// 允许的字符串长度限制（防止DoS）
const MAX_STRING_LENGTH = 10000;
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 100000;

// ==================== 性能配置 ====================

// 请求缓存配置
const REQUEST_CACHE = new Map();
const CACHE_TTL = 30000; // 30秒缓存
const MAX_CACHE_SIZE = 100; // 最大缓存条目数

// HTTP 错误处理配置
const HTTP_ERROR_HANDLERS = {
  400: {
    error_type: 'invalid_request',
    solution: '请求参数错误。请检查:\n' +
      '1. 参数格式是否正确\n' +
      '2. space_id/node_token等标识符是否有效\n' +
      '3. 必填参数是否完整\n' +
      '4. 内容长度是否超出限制'
  },
  403: {
    error_type: 'permission_denied',
    solution: '权限不足。请尝试:\n' +
      '1. 刷新用户Token\n' +
      '2. 检查应用权限配置\n' +
      '3. 确认账号有相应资源访问权限\n' +
      '4. 检查是否被移除协作者权限'
  },
  404: {
    error_type: 'not_found',
    solution: '资源不存在。请确认:\n' +
      '1. space_id/node_token是否正确\n' +
      '2. 资源是否已被删除\n' +
      '3. 是否有访问该资源的权限\n' +
      '4. 是否在正确的空间中搜索'
  },
  409: {
    error_type: 'conflict',
    solution: '资源冲突。可能原因:\n' +
      '1. 文档正在被其他人编辑\n' +
      '2. 资源名称重复\n' +
      '3. 操作冲突，请稍后重试'
  },
  429: {
    error_type: 'too_many_requests',
    solution: '请求过于频繁。请:\n' +
      '1. 等待1分钟后重试\n' +
      '2. 减少并发请求数量\n' +
      '3. 使用批量操作提高效率'
  },
  500: {
    error_type: 'server_error',
    solution: '飞书服务器内部错误。请:\n' +
      '1. 稍后重试\n' +
      '2. 检查飞书状态页\n' +
      '3. 如持续出现，联系飞书客服'
  },
  502: {
    error_type: 'bad_gateway',
    solution: '网关错误。请:\n' +
      '1. 稍后重试\n' +
      '2. 检查网络连接\n' +
      '3. 确认飞书服务状态'
  },
  503: {
    error_type: 'service_unavailable',
    solution: '服务暂时不可用。请:\n' +
      '1. 稍后重试\n' +
      '2. 检查飞书维护公告\n' +
      '3. 确认是否为区域性故障'
  }
};

/**
 * 清理过期的缓存条目
 */
function cleanExpiredCache() {
  const now = Date.now();
  const keysToDelete = [];

  for (const [key, value] of REQUEST_CACHE.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      keysToDelete.push(key);
    }
  }

  keysToDelete.forEach(key => REQUEST_CACHE.delete(key));

  // 如果缓存仍然太大，删除最旧的条目
  if (REQUEST_CACHE.size > MAX_CACHE_SIZE) {
    const entries = [...REQUEST_CACHE.entries()];
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    const toDelete = entries.slice(0, entries.length - MAX_CACHE_SIZE);
    toDelete.forEach(([key]) => REQUEST_CACHE.delete(key));
  }
}

/**
 * 生成缓存键
 */
function generateCacheKey(method, path, queryParams) {
  return `${method}:${path}:${JSON.stringify(queryParams || {})}`;
}

/**
 * 从缓存获取数据
 */
function getCachedData(method, path, queryParams) {
  if (method.toUpperCase() !== 'GET') {
    return null;
  }

  const key = generateCacheKey(method, path, queryParams);
  const cached = REQUEST_CACHE.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  return null;
}

/**
 * 缓存数据
 */
function setCachedData(method, path, queryParams, data) {
  if (method.toUpperCase() !== 'GET') {
    return;
  }

  const key = generateCacheKey(method, path, queryParams);
  REQUEST_CACHE.set(key, {
    data,
    timestamp: Date.now()
  });

  // 定期清理缓存
  if (REQUEST_CACHE.size > MAX_CACHE_SIZE * 0.8) {
    cleanExpiredCache();
  }
}

// ==================== 工具函数 ====================

/**
 * 验证字符串长度
 */
function validateStringLength(str, maxLength, fieldName) {
  if (typeof str !== 'string') {
    throw new Error(`${fieldName} 必须是字符串类型`);
  }
  if (str.length > maxLength) {
    throw new Error(`${fieldName} 长度超过限制 (${maxLength} 字符)`);
  }
  return str;
}

/**
 * 验证并清理 Token/ID 参数（防止注入攻击）
 */
function validateToken(token, fieldName = 'Token') {
  if (typeof token !== 'string') {
    throw new Error(`${fieldName} 必须是字符串类型`);
  }
  // 飞书 token 通常是字母数字和下划线/连字符
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  if (!validPattern.test(token)) {
    throw new Error(`${fieldName} 格式无效（仅允许字母、数字、下划线和连字符）`);
  }
  return token;
}

/**
 * 验证并清理用户输入的标题
 */
function validateTitle(title, fieldName = '标题') {
  if (!title || typeof title !== 'string') {
    throw new Error(`${fieldName} 不能为空且必须是字符串`);
  }
  // 移除潜在的危险字符
  const cleaned = title.trim()
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '') // 移除控制字符
    .replace(/<script[^>]*>.*?<\/script>/gis, ''); // 移除简单的脚本标签
  return validateStringLength(cleaned, MAX_TITLE_LENGTH, fieldName);
}

/**
 * 验证并清理文档内容
 */
function validateContent(content, fieldName = '内容') {
  if (content === null || content === undefined) {
    return ''; // 允许空内容
  }
  if (typeof content !== 'string') {
    throw new Error(`${fieldName} 必须是字符串类型`);
  }
  return validateStringLength(content, MAX_CONTENT_LENGTH, fieldName);
}

/**
 * 获取文件修改时间
 */
function getFileModTime(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * 将秒数转换为人类可读的格式
 */
function formatSeconds(seconds) {
  if (seconds < 0) return "已过期";

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) {
    return `${days}天${hours}小时`;
  } else if (hours > 0) {
    return `${hours}小时${minutes}分钟`;
  } else if (minutes > 0) {
    return `${minutes}分钟${secs}秒`;
  } else {
    return `${secs}秒`;
  }
}

/**
 * 根据状态提供建议
 */
function getRecommendations(refreshStatus, accessExpiresIn, refreshExpiresIn) {
  const recommendations = [];

  // access_token 即将过期或已过期
  if (accessExpiresIn < 300) {
    if (accessExpiresIn <= 0) {
      recommendations.push({
        priority: "urgent",
        type: "access_token_expired",
        message: "access_token 已过期",
        action: "系统会自动刷新（如果 refresh_token 有效）",
      });
    } else {
      recommendations.push({
        priority: "info",
        type: "access_token_expiring",
        message: `access_token 将在 ${formatSeconds(accessExpiresIn)} 后过期`,
        action: "系统会自动刷新，无需担心",
      });
    }
  }

  // refresh_token 状态建议
  if (refreshStatus === "expired") {
    recommendations.push({
      priority: "critical",
      type: "refresh_token_expired",
      message: "refresh_token 已过期，需要重新授权",
      action: "请使用 start_auth_server 工具启动授权流程",
    });
  } else if (refreshStatus === "critical") {
    recommendations.push({
      priority: "urgent",
      type: "refresh_token_expiring_soon",
      message: `refresh_token 将在 ${formatSeconds(refreshExpiresIn)} 后过期`,
      action: "建议尽快重新授权以避免服务中断",
    });
  } else if (refreshStatus === "warning") {
    recommendations.push({
      priority: "reminder",
      type: "refresh_token_expiring",
      message: `refresh_token 将在 ${formatSeconds(refreshExpiresIn)} 后过期`,
      action: "建议在方便时重新授权",
    });
  } else {
    recommendations.push({
      priority: "info",
      type: "all_good",
      message: "Token 状态正常",
      action: "无需操作，系统会自动维护 Token",
    });
  }

  return recommendations;
}

/**
 * 获取 tenant_access_token
 */
async function getTenantAccessToken() {
  const now = Date.now() / 1000;
  if (tokenCache.token && now < tokenCache.expiry) {
    return tokenCache.token;
  }

  const response = await axios.post(
    `${BASE_URL}/auth/v3/tenant_access_token/internal`,
    {
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET,
    },
    {
      headers: { "Content-Type": "application/json" },
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

/**
 * 刷新用户 Token（增强版，带重试机制）
 */
async function refreshUserToken(tokenData, retryCount = 0) {
  const now = Date.now() / 1000;

  try {
    const response = await axios.post(
      `${BASE_URL}/authen/v1/oidc/refresh_access_token`,
      {
        app_id: FEISHU_APP_ID,
        app_secret: FEISHU_APP_SECRET,
        grant_type: "refresh_token",
        refresh_token: tokenData.refresh_token,
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,  // 10秒超时
      }
    );

    if (response.data.code !== 0) {
      throw new Error(`刷新 Token 失败 [${response.data.code}]: ${response.data.msg}`);
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
    fs.writeFileSync(USER_TOKEN_FILE, JSON.stringify(updatedData, null, 2));

    userTokenCache = {
      token: newTokenData.access_token,
      expiry: expiresAt,
      fileModTime: getFileModTime(USER_TOKEN_FILE),
      refreshTimer: null,
    };

    console.error(`✓ 用户 Token 已刷新 (有效期至: ${new Date(expiresAt * 1000).toLocaleString()})`);
    return userTokenCache.token;

  } catch (error) {
    // 重试机制
    if (retryCount < TOKEN_REFRESH_RETRY_COUNT) {
      console.error(`Token 刷新失败，${TOKEN_REFRESH_RETRY_DELAY / 1000}秒后重试 (${retryCount + 1}/${TOKEN_REFRESH_RETRY_COUNT})...`);
      await new Promise(resolve => setTimeout(resolve, TOKEN_REFRESH_RETRY_DELAY));
      return refreshUserToken(tokenData, retryCount + 1);
    }

    // 重试次数用尽，抛出错误
    console.error(`✗ Token 刷新失败，已重试 ${TOKEN_REFRESH_RETRY_COUNT} 次`);
    throw error;
  }
}

/**
 * 获取 user_access_token（增强版）
 *
 * 改进点：
 * 1. 检查文件修改时间，如果文件被外部更新则重新加载
 * 2. 主动刷新机制：在 token 过期前自动刷新
 * 3. 更详细的错误信息
 */
async function getUserAccessToken() {
  const now = Date.now() / 1000;
  const fileModTime = getFileModTime(USER_TOKEN_FILE);

  // 检查文件是否被外部修改
  if (userTokenCache.fileModTime > 0 && fileModTime > userTokenCache.fileModTime) {
    console.error("检测到 user_token.json 被外部修改，重新加载...");
    userTokenCache.token = null;  // 清除缓存，强制重新加载
  }

  // 检查缓存是否有效（提前刷新时间）
  if (userTokenCache.token && now < (userTokenCache.expiry - TOKEN_REFRESH_ADVANCE)) {
    return userTokenCache.token;
  }

  // 从文件读取
  if (!fs.existsSync(USER_TOKEN_FILE)) {
    throw new Error(
      "未找到用户 Token 文件。请先运行用户认证:\n" +
      '  1. 运行: node auth_server.js\n' +
      "  2. 在浏览器中完成授权\n" +
      "  3. 重试当前操作"
    );
  }

  const tokenData = JSON.parse(fs.readFileSync(USER_TOKEN_FILE, "utf8"));

  // 检查是否即将过期（提前刷新）
  if (tokenData.expires_at > now && tokenData.expires_at - now < TOKEN_REFRESH_ADVANCE) {
    // Token 即将过期，尝试刷新
    if (tokenData.refresh_token) {
      try {
        console.error("Token 即将过期，主动刷新中...");
        return await refreshUserToken(tokenData);
      } catch (e) {
        console.error("主动刷新失败:", e.message);
        // 刷新失败，继续使用现有 token
      }
    }
  }

  // Token 仍然有效
  if (tokenData.expires_at > now) {
    userTokenCache = {
      token: tokenData.access_token,
      expiry: tokenData.expires_at,
      fileModTime: fileModTime,
      refreshTimer: null,
    };
    return userTokenCache.token;
  }

  // Token 已过期，尝试刷新
  if (tokenData.refresh_token) {
    try {
      return await refreshUserToken(tokenData);
    } catch (e) {
      throw new Error(
        `用户 Token 已过期且刷新失败: ${e.message}\n\n` +
        "请重新进行用户认证:\n" +
        '  1. 运行: node auth_server.js\n' +
        "  2. 在浏览器中完成授权"
      );
    }
  }

  throw new Error(
    "用户 Token 已过期且无 refresh_token。\n\n" +
    "请重新进行用户认证:\n" +
    '  1. 运行: node auth_server.js\n' +
    "  2. 在浏览器中完成授权"
  );
}

/**
 * 验证用户 Token 是否有效
 */
async function validateUserToken() {
  try {
    const token = await getUserAccessToken();
    const response = await axios.get(
      `${BASE_URL}/authen/v1/user_info`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.data.code === 0) {
      return {
        valid: true,
        user: response.data.data,
        expiry: userTokenCache.expiry,
        expires_in: Math.max(0, userTokenCache.expiry - Date.now() / 1000),
      };
    }

    return {
      valid: false,
      error: `API 返回错误: ${response.data.msg}`,
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

/**
 * 发送飞书 API 请求
 * @param {string} method - HTTP 方法
 * @param {string} path - API 路径
 * @param {object} data - 请求数据
 * @param {object} queryParams - 查询参数
 * @param {boolean} useUserToken - 是否使用用户 token
 */
async function feishuRequest(method, path, data = null, queryParams = null, useUserToken = false) {
  // 检查缓存（仅对 GET 请求）
  const cached = getCachedData(method, path, queryParams);
  if (cached !== null) {
    return cached;
  }

  const token = useUserToken ? await getUserAccessToken() : await getTenantAccessToken();
  const config = {
    method,
    url: `${BASE_URL}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (data) {
    config.data = data;
  }

  if (queryParams) {
    config.params = queryParams;
  }

  const response = await axios(config);

  if (response.data.code !== 0) {
    throw new Error(`API 请求失败 [${response.data.code}]: ${response.data.msg}`);
  }

  // 缓存 GET 请求结果
  setCachedData(method, path, queryParams, response.data);

  return response.data;
}

// ==================== MCP 服务器初始化 ====================

const server = new Server(
  {
    name: "feishu-enterprise-mcp-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ==================== 工具列表 ====================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // ========== 文档相关 ==========
      {
        name: "create_document",
        description:
          "在飞书中创建新文档。需要提供文件夹token、文档标题和内容。",
        inputSchema: {
          type: "object",
          properties: {
            folder_token: {
              type: "string",
              description: "目标文件夹的token",
            },
            title: {
              type: "string",
              description: "文档标题",
            },
            content: {
              type: "string",
              description: "文档内容（支持Markdown格式）",
            },
          },
          required: ["folder_token", "title", "content"],
        },
      },
      {
        name: "get_document_content",
        description: "获取飞书文档的内容（纯文本）",
        inputSchema: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "文档ID",
            },
          },
          required: ["document_id"],
        },
      },
      {
        name: "update_document",
        description: "更新飞书文档的内容",
        inputSchema: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "文档ID",
            },
            content: {
              type: "string",
              description: "新的文档内容",
            },
            block_id: {
              type: "string",
              description: "要更新的块ID（可选，不提供则追加内容）",
            },
          },
          required: ["document_id", "content"],
        },
      },
      {
        name: "list_document_blocks",
        description: "列出文档的所有块（分页）",
        inputSchema: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "文档ID",
            },
            page_size: {
              type: "number",
              description: "每页数量（默认100）",
              default: 100,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
          },
          required: ["document_id"],
        },
      },

      // ========== Wiki 知识库相关 ==========
      {
        name: "create_wiki_space",
        description: "创建 Wiki 知识空间",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "知识空间名称",
            },
            description: {
              type: "string",
              description: "知识空间描述",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "list_wiki_spaces",
        description: "获取用户可访问的所有 Wiki 知识空间列表",
        inputSchema: {
          type: "object",
          properties: {
            page_size: {
              type: "number",
              description: "每页数量",
              default: 10,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
          },
        },
      },
      {
        name: "get_wiki_space",
        description: "获取 Wiki 知识空间的详细信息",
        inputSchema: {
          type: "object",
          properties: {
            space_id: {
              type: "string",
              description: "知识空间ID",
            },
          },
          required: ["space_id"],
        },
      },
      {
        name: "create_wiki_node",
        description: "在 Wiki 知识空间中创建节点（文档/文件夹）",
        inputSchema: {
          type: "object",
          properties: {
            space_id: {
              type: "string",
              description: "知识空间ID",
            },
            parent_node_token: {
              type: "string",
              description: "父节点token（根节点可不填）",
            },
            title: {
              type: "string",
              description: "节点标题",
            },
            node_type: {
              type: "string",
              description: "节点类型: origin(创建新节点) 或 shortcut(快捷方式)。默认为origin",
              enum: ["origin", "shortcut"],
              default: "origin",
            },
            obj_type: {
              type: "string",
              description: "当node_type=origin时指定对象类型: docx(文档), sheet(表格), mindnote(思维导图), bitable(多维表格), file(文件)。创建文件夹时不传此参数",
              enum: ["docx", "sheet", "mindnote", "bitable", "file"],
            },
            origin_node_token: {
              type: "string",
              description: "当node_type=shortcut时，源节点的token",
            },
          },
          required: ["space_id", "title"],
        },
      },
      {
        name: "get_wiki_node",
        description: "获取 Wiki 节点的详细信息",
        inputSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "节点token",
            },
            space_id: {
              type: "string",
              description: "知识空间ID",
            },
          },
          required: ["token"],
        },
      },
      {
        name: "list_wiki_nodes",
        description: "获取 Wiki 知识空间的所有子节点",
        inputSchema: {
          type: "object",
          properties: {
            space_id: {
              type: "string",
              description: "知识空间ID",
            },
            parent_node_token: {
              type: "string",
              description: "父节点token（不填则获取根节点）",
            },
            page_size: {
              type: "number",
              description: "每页数量",
              default: 50,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
          },
          required: ["space_id"],
        },
      },

      // ========== 多维表格相关 ==========
      {
        name: "create_bitable",
        description: "创建多维表格",
        inputSchema: {
          type: "object",
          properties: {
            folder_token: {
              type: "string",
              description: "文件夹token",
            },
            title: {
              type: "string",
              description: "表格标题",
            },
            app_token: {
              type: "string",
              description: "应用token（在现有多维表格中创建数据表时需要）",
            },
          },
          required: ["title"],
        },
      },
      {
        name: "get_bitable_records",
        description: "获取多维表格数据表的记录",
        inputSchema: {
          type: "object",
          properties: {
            app_token: {
              type: "string",
              description: "多维表格应用token",
            },
            table_id: {
              type: "string",
              description: "数据表ID",
            },
            page_size: {
              type: "number",
              description: "每页数量",
              default: 20,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
            sort: {
              type: "array",
              description: "排序规则",
              items: {
                type: "object",
              },
            },
            filter: {
              type: "object",
              description: "筛选条件",
            },
          },
          required: ["app_token", "table_id"],
        },
      },
      {
        name: "create_bitable_record",
        description: "在多维表格中创建新记录",
        inputSchema: {
          type: "object",
          properties: {
            app_token: {
              type: "string",
              description: "多维表格应用token",
            },
            table_id: {
              type: "string",
              description: "数据表ID",
            },
            fields: {
              type: "object",
              description: "记录的字段数据",
            },
          },
          required: ["app_token", "table_id", "fields"],
        },
      },
      {
        name: "update_bitable_record",
        description: "更新多维表格中的记录",
        inputSchema: {
          type: "object",
          properties: {
            app_token: {
              type: "string",
              description: "多维表格应用token",
            },
            table_id: {
              type: "string",
              description: "数据表ID",
            },
            record_id: {
              type: "string",
              description: "记录ID",
            },
            fields: {
              type: "object",
              description: "要更新的字段数据",
            },
          },
          required: ["app_token", "table_id", "record_id", "fields"],
        },
      },

      // ========== 消息发送相关 ==========
      {
        name: "send_message",
        description: "发送消息到飞书群聊或单聊",
        inputSchema: {
          type: "object",
          properties: {
            receive_id_type: {
              type: "string",
              description: "接收ID类型: chat_id, open_id, user_id, union_id, email",
              enum: ["chat_id", "open_id", "user_id", "union_id", "email"],
              default: "open_id",
            },
            receive_id: {
              type: "string",
              description: "接收者ID",
            },
            msg_type: {
              type: "string",
              description: "消息类型: text, post, interactive, card",
              enum: ["text", "post", "interactive", "card"],
              default: "text",
            },
            content: {
              type: "string",
              description: "消息内容（JSON字符串或纯文本）",
            },
          },
          required: ["receive_id", "content"],
        },
      },

      // ========== 日历事件相关 ==========
      {
        name: "create_calendar_event",
        description: "创建日历事件",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: {
              type: "string",
              description: "日历ID（默认为主日历）",
              default: "feishu.cn_primary_calendar",
            },
            summary: {
              type: "string",
              description: "事件标题",
            },
            description: {
              type: "string",
              description: "事件描述",
            },
            start_time: {
              type: "string",
              description: "开始时间（RFC3339格式）",
            },
            end_time: {
              type: "string",
              description: "结束时间（RFC3339格式）",
            },
            attendee_able: {
              type: "boolean",
              description: "是否支持参与者",
              default: false,
            },
            location: {
              type: "string",
              description: "事件地点",
            },
          },
          required: ["summary", "start_time", "end_time"],
        },
      },
      {
        name: "get_calendar_event",
        description: "获取日历事件详情",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: {
              type: "string",
              description: "日历ID",
            },
            event_id: {
              type: "string",
              description: "事件ID",
            },
          },
          required: ["calendar_id", "event_id"],
        },
      },
      {
        name: "list_calendar_events",
        description: "获取日历事件列表",
        inputSchema: {
          type: "object",
          properties: {
            calendar_id: {
              type: "string",
              description: "日历ID",
            },
            page_size: {
              type: "number",
              description: "每页数量",
              default: 20,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
          },
          required: ["calendar_id"],
        },
      },

      // ========== 文件夹相关 ==========
      {
        name: "list_files",
        description: "列出文件夹中的文件和子文件夹",
        inputSchema: {
          type: "object",
          properties: {
            folder_token: {
              type: "string",
              description: "文件夹token（不填则列出根目录）",
            },
            page_size: {
              type: "number",
              description: "每页数量",
              default: 50,
            },
            page_token: {
              type: "string",
              description: "分页token",
            },
          },
        },
      },
      {
        name: "create_folder",
        description: "创建文件夹",
        inputSchema: {
          type: "object",
          properties: {
            parent_token: {
              type: "string",
              description: "父文件夹token（不填则在根目录创建）",
            },
            name: {
              type: "string",
              description: "文件夹名称",
            },
          },
          required: ["name"],
        },
      },

      // ========== 驱动/文档通用 ==========
      {
        name: "get_file_info",
        description: "获取文件/文档信息",
        inputSchema: {
          type: "object",
          properties: {
            token: {
              type: "string",
              description: "文件/文档token",
            },
            type: {
              type: "string",
              description: "文件类型: docx, sheet, bitable, file, folder, wiki, mindnote, drive",
              enum: ["docx", "sheet", "bitable", "file", "folder", "wiki", "mindnote", "drive"],
            },
          },
          required: ["token", "type"],
        },
      },

      // ========== 用户相关 ==========
      {
        name: "get_user_info",
        description: "获取用户信息",
        inputSchema: {
          type: "object",
          properties: {
            user_id: {
              type: "string",
              description: "用户ID（open_id、union_id或user_id）",
            },
            user_id_type: {
              type: "string",
              description: "用户ID类型",
              enum: ["open_id", "union_id", "user_id"],
              default: "open_id",
            },
          },
          required: ["user_id"],
        },
      },
      {
        name: "get_department_info",
        description: "获取部门信息",
        inputSchema: {
          type: "object",
          properties: {
            department_id: {
              type: "string",
              description: "部门ID",
            },
            department_id_type: {
              type: "string",
              description: "部门ID类型",
              enum: ["department_id", "open_department_id"],
              default: "open_department_id",
            },
          },
          required: ["department_id"],
        },
      },

      // ========== Token 管理相关 ==========
      {
        name: "check_token_health",
        description: "检查用户 Token 的健康状态和有效性",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "reload_user_token",
        description: "强制从文件重新加载用户 Token（清除内存缓存）",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "get_refresh_token_status",
        description: "检测 refresh_token 的过期状态和剩余时间",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "start_auth_server",
        description: "自动启动授权服务器进行重新认证（当 refresh_token 过期时使用）",
        inputSchema: {
          type: "object",
          properties: {
            auto_open_browser: {
              type: "boolean",
              description: "是否自动打开浏览器（默认 true）",
              default: true,
            },
          },
        },
      },
      {
        name: "auto_auth",
        description: "使用 Puppeteer 自动进行飞书授权（支持自动登录）",
        inputSchema: {
          type: "object",
          properties: {
            headless: {
              type: "boolean",
              description: "是否使用无头模式（不显示浏览器窗口），默认 false",
              default: false,
            },
            auto_login: {
              type: "boolean",
              description: "是否使用保存的 session 自动登录，默认 true",
              default: true,
            },
          },
        },
      },
    ],
  };
});

// ==================== 工具实现 ====================

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      // ========== 文档相关 ==========
      case "create_document": {
        // 1. 创建空白文档 (使用 user token)
        const createResult = await feishuRequest("POST", "/docx/v1/documents", {
          folder_token: args.folder_token,
          title: args.title,
        }, null, true);  // 使用 user token

        const documentId = createResult.data.document.document_id;
        const documentUrl = createResult.data.document.url;

        // 2. 获取初始块 (使用 user token)
        const blocksResult = await feishuRequest(
          "GET",
          `/docx/v1/documents/${documentId}/blocks`,
          null, null, true  // 使用 user token
        );
        const firstBlockId = blocksResult.data.items[0]?.block_id;

        if (firstBlockId && args.content) {
          // 3. 添加内容 (使用 user token)
          const children = [];
          for (const line of args.content.split("\n")) {
            if (line.trim()) {
              children.push({
                block_type: 2, // 文本块
                text: {
                  elements: [
                    {
                      text_run: {
                        content: line,
                      },
                    },
                  ],
                },
              });
            }
          }

          await feishuRequest(
            "PATCH",
            `/docx/v1/documents/${documentId}/blocks/${firstBlockId}/children`,
            { children },
            null, true  // 使用 user token
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  document_id: documentId,
                  url: documentUrl,
                  message: "文档创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_document_content": {
        const blocksResult = await feishuRequest(
          "GET",
          `/docx/v1/documents/${args.document_id}/blocks`,
          null,
          { page_size: 500 },
          true  // 使用 user token
        );

        const contentParts = [];
        const items = blocksResult.data.items || [];

        const blockTypeMap = {
          2: "text",
          3: "heading1",
          4: "heading2",
          5: "heading3",
          12: "todo",
        };

        for (const item of items) {
          const blockType = item.block_type;
          const contentType = blockTypeMap[blockType];

          if (contentType && item[contentType]) {
            const elements = item[contentType].elements || [];
            for (const elem of elements) {
              if (elem.text_run) {
                contentParts.push(elem.text_run.content);
              }
            }
          }
        }

        return {
          content: [
            {
              type: "text",
              text: contentParts.join("\n"),
            },
          ],
        };
      }

      case "update_document": {
        // 获取文档块列表 (使用 user token)
        const blocksResult = await feishuRequest(
          "GET",
          `/docx/v1/documents/${args.document_id}/blocks`,
          null, null, true  // 使用 user token
        );
        const firstBlockId = blocksResult.data.items[0]?.block_id;

        const targetBlockId = args.block_id || firstBlockId;

        // 将内容按行拆分为块
        const children = [];
        for (const line of args.content.split("\n")) {
          if (line.trim()) {
            children.push({
              block_type: 2,
              text: {
                elements: [{ text_run: { content: line } }],
              },
            });
          }
        }

        await feishuRequest(
          "PATCH",
          `/docx/v1/documents/${args.document_id}/blocks/${targetBlockId}/children`,
          { children },
          null, true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                { success: true, message: "文档更新成功" },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_document_blocks": {
        const params = { page_size: args.page_size || 100 };
        if (args.page_token) {
          params.page_token = args.page_token;
        }

        const result = await feishuRequest(
          "GET",
          `/docx/v1/documents/${args.document_id}/blocks`,
          null,
          params,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      // ========== Wiki 知识库相关 ==========
      case "create_wiki_space": {
        const result = await feishuRequest("POST", "/wiki/v2/spaces", {
          name: args.name,
          description: args.description || "",
        }, null, true); // 使用 user token

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  space_id: result.data.space.space_id,
                  name: result.data.space.name,
                  message: "Wiki 知识空间创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "list_wiki_spaces": {
        const params = { page_size: args.page_size || 10 };
        if (args.page_token) {
          params.page_token = args.page_token;
        }

        const result = await feishuRequest(
          "GET",
          "/wiki/v2/spaces",
          null,
          params,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "get_wiki_space": {
        const result = await feishuRequest(
          "GET",
          `/wiki/v2/spaces/${args.space_id}`,
          null,
          null,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "create_wiki_node": {
        // 参数验证
        const nodeType = args.node_type || "origin";

        // 如果是快捷方式，必须提供 origin_node_token
        if (nodeType === "shortcut" && !args.origin_node_token) {
          throw new Error("创建快捷方式时必须提供 origin_node_token 参数");
        }

        // 构建请求参数
        const requestData = {
          parent_node_token: args.parent_node_token || "",
          node_type: nodeType,
          title: args.title,
        };

        // 只有当node_type为origin且提供了obj_type时才添加
        if (nodeType === "origin" && args.obj_type) {
          requestData.obj_type = args.obj_type;
        }

        // 如果是快捷方式，需要 origin_node_token
        if (nodeType === "shortcut") {
          requestData.origin_node_token = args.origin_node_token;
        }

        const result = await feishuRequest(
          "POST",
          `/wiki/v2/spaces/${args.space_id}/nodes`,
          requestData,
          null,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  node_token: result.data.node.node_token,
                  title: result.data.node.title,
                  node_type: result.data.node.node_type,
                  obj_type: result.data.node.obj_type,
                  message: "Wiki 节点创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_wiki_node": {
        // 飞书API要求: GET /wiki/v2/spaces/{space_id}/nodes/{node_token}
        if (!args.space_id) {
          throw new Error("get_wiki_node 需要 space_id 参数");
        }

        const result = await feishuRequest(
          "GET",
          `/wiki/v2/spaces/${args.space_id}/nodes/${args.token}`,
          null,
          null,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "list_wiki_nodes": {
        const params = {
          page_size: args.page_size || 50,
        };
        if (args.page_token) {
          params.page_token = args.page_token;
        }
        if (args.parent_node_token) {
          params.parent_node_token = args.parent_node_token;
        }

        const result = await feishuRequest(
          "GET",
          `/wiki/v2/spaces/${args.space_id}/nodes`,
          null,
          params,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      // ========== 多维表格相关 ==========
      case "create_bitable": {
        if (args.app_token) {
          // 在现有多维表格中创建数据表
          const result = await feishuRequest(
            "POST",
            `/bitable/v1/apps/${args.app_token}/tables`,
            {
              table: {
                name: args.title,
              },
            }
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    table_id: result.data.table.table_id,
                    message: "数据表创建成功",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else {
          // 创建新的多维表格应用
          const result = await feishuRequest("POST", "/bitable/v1/apps", {
            folder_token: args.folder_token || "",
            name: args.title,
          });

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: true,
                    app_token: result.data.app.app_token,
                    url: result.data.app.url,
                    message: "多维表格创建成功",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      }

      case "get_bitable_records": {
        const params = { page_size: args.page_size || 20 };
        if (args.page_token) {
          params.page_token = args.page_token;
        }
        if (args.sort) {
          params.sort = JSON.stringify(args.sort);
        }
        if (args.filter) {
          params.filter = JSON.stringify(args.filter);
        }

        const result = await feishuRequest(
          "GET",
          `/bitable/v1/apps/${args.app_token}/tables/${args.table_id}/records`,
          null,
          params,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "create_bitable_record": {
        const result = await feishuRequest(
          "POST",
          `/bitable/v1/apps/${args.app_token}/tables/${args.table_id}/records`,
          { fields: args.fields },
          null,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  record_id: result.data.record.record_id,
                  message: "记录创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "update_bitable_record": {
        const result = await feishuRequest(
          "PUT",
          `/bitable/v1/apps/${args.app_token}/tables/${args.table_id}/records/${args.record_id}`,
          { fields: args.fields },
          null,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  record_id: result.data.record.record_id,
                  message: "记录更新成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ========== 消息发送相关 ==========
      case "send_message": {
        // content 字段必须是 JSON 字符串
        let contentJson;
        const msgType = args.msg_type || "text";

        if (msgType === "text") {
          // 文本消息: {"text":"内容"}
          contentJson = JSON.stringify({ text: args.content });
        } else if (msgType === "post") {
          // 富文本消息
          contentJson = typeof args.content === "string" ? args.content : JSON.stringify(args.content);
        } else if (msgType === "interactive") {
          // 交互式消息
          contentJson = typeof args.content === "string" ? args.content : JSON.stringify(args.content);
        } else {
          contentJson = args.content;
        }

        const result = await feishuRequest("POST", "/message/v4/send", {
          receive_id_type: args.receive_id_type || "open_id",
          receive_id: args.receive_id,
          msg_type: msgType,
          content: contentJson,
        }, null, true);  // 使用 user token

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message_id: result.data.message_id,
                  message: "消息发送成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ========== 日历事件相关 ==========
      case "create_calendar_event": {
        const result = await feishuRequest(
          "POST",
          `/calendar/v4/calendars/${args.calendar_id || "primary"}/events`,
          {
            summary: args.summary,
            description: args.description || "",
            start_time: {
              timestamp: args.start_time,
            },
            end_time: {
              timestamp: args.end_time,
            },
            attendee_able: args.attendee_able || false,
            location: args.location || "",
          },
          null,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  event_id: result.data.event.event_id,
                  message: "日历事件创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_calendar_event": {
        const result = await feishuRequest(
          "GET",
          `/calendar/v4/calendars/${args.calendar_id}/events/${args.event_id}`,
          null,
          null,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "list_calendar_events": {
        const params = { page_size: args.page_size || 50 };
        if (args.page_token) {
          params.page_token = args.page_token;
        }

        const result = await feishuRequest(
          "GET",
          `/calendar/v4/calendars/${args.calendar_id}/events`,
          null,
          params,
          true // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      // ========== 文件夹相关 ==========
      case "list_files": {
        // 如果有 folder_token，获取该文件夹的子项
        // 否则使用搜索API获取根目录文件
        if (args.folder_token) {
          const params = { page_size: args.page_size || 50 };
          if (args.page_token) {
            params.page_token = args.page_token;
          }

          const result = await feishuRequest(
            "GET",
            `/drive/v1/files/${args.folder_token}/children`,
            null,
            params,
            true  // 使用 user token
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.data, null, 2),
              },
            ],
          };
        } else {
          // 没有folder_token时，使用搜索API（需要用户权限）
          const params = {
            page_size: args.page_size || 50,
            type: "folder", // 先搜索文件夹
          };
          if (args.page_token) {
            params.page_token = args.page_token;
          }

          const result = await feishuRequest(
            "POST",
            "/drive/v1/files/search",
            { query: "" },
            params,
            true  // 使用 user token
          );

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(result.data, null, 2),
              },
            ],
          };
        }
      }

      case "create_folder": {
        const result = await feishuRequest("POST", "/drive/v1/files", {
          type: "folder",
          name: args.name,
          parent_token: args.parent_token || "",
        }, null, true);  // 使用 user token

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  file_token: result.data.file.file_token,
                  name: result.data.file.name,
                  message: "文件夹创建成功",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      // ========== 驱动/文档通用 ==========
      case "get_file_info": {
        // 飞书API: GET /drive/v1/files/:file_token
        const result = await feishuRequest(
          "GET",
          `/drive/v1/files/${args.token}`,
          null, null,
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      // ========== 用户相关 ==========
      case "get_user_info": {
        const result = await feishuRequest(
          "GET",
          `/contact/v3/users/${args.user_id}`,
          null,
          { user_id_type: args.user_id_type || "open_id" },
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      case "get_department_info": {
        const result = await feishuRequest(
          "GET",
          `/contact/v3/departments/${args.department_id}`,
          null,
          {
            department_id_type: args.department_id_type || "open_department_id",
          },
          true  // 使用 user token
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result.data, null, 2),
            },
          ],
        };
      }

      // ========== Token 管理相关 ==========
      case "check_token_health": {
        const health = await validateUserToken();

        // 添加 token 文件信息
        const tokenFileInfo = fs.existsSync(USER_TOKEN_FILE)
          ? {
              exists: true,
              mod_time: new Date(getFileModTime(USER_TOKEN_FILE)).toISOString(),
              file_path: USER_TOKEN_FILE,
            }
          : {
              exists: false,
              file_path: USER_TOKEN_FILE,
            };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ...health,
                  token_file: tokenFileInfo,
                  current_time: new Date().toISOString(),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "reload_user_token": {
        // 清除缓存
        userTokenCache = {
          token: null,
          expiry: 0,
          fileModTime: 0,
          refreshTimer: null,
        };

        // 重新加载
        await getUserAccessToken();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "用户 Token 已从文件重新加载",
                  expires_at: new Date(userTokenCache.expiry * 1000).toISOString(),
                  expires_in: Math.max(0, userTokenCache.expiry - Date.now() / 1000),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_refresh_token_status": {
        // 检测 refresh_token 状态
        if (!fs.existsSync(USER_TOKEN_FILE)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    has_token_file: false,
                    message: "未找到 user_token.json 文件",
                    solution: "请先运行授权: node auth_server.js",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        const tokenData = JSON.parse(fs.readFileSync(USER_TOKEN_FILE, "utf8"));
        const now = Date.now() / 1000;
        const accessExpiresIn = tokenData.expires_at - now;

        // refresh_token 有效期约为 30 天（2592000 秒）
        // 从 saved_at 时间计算
        const savedAt = new Date(tokenData.saved_at).getTime() / 1000;
        const refreshExpiresAt = savedAt + 2592000; // 30天
        const refreshExpiresIn = refreshExpiresAt - now;

        // 计算状态
        let accessStatus = "unknown";
        if (accessExpiresIn > 86400) {
          accessStatus = "healthy";  // 超过1天
        } else if (accessExpiresIn > 300) {
          accessStatus = "warning";  // 5分钟到1天
        } else if (accessExpiresIn > 0) {
          accessStatus = "critical"; // 5分钟内
        } else {
          accessStatus = "expired";
        }

        let refreshStatus = "unknown";
        let warningLevel = "none";

        if (refreshExpiresIn > 86400 * 7) {
          refreshStatus = "healthy";
          warningLevel = "none";
        } else if (refreshExpiresIn > 86400 * 3) {
          refreshStatus = "warning";
          warningLevel = "reminder";  // 3-7天，提醒
        } else if (refreshExpiresIn > 0) {
          refreshStatus = "critical";
          warningLevel = "urgent";    // 3天内，紧急
        } else {
          refreshStatus = "expired";
          warningLevel = "expired";   // 已过期
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  has_token_file: true,
                  access_token: {
                    status: accessStatus,
                    expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
                    expires_in_seconds: Math.floor(accessExpiresIn),
                    expires_in_human: formatSeconds(Math.floor(accessExpiresIn)),
                  },
                  refresh_token: {
                    status: refreshStatus,
                    estimated_expires_at: new Date(refreshExpiresAt * 1000).toISOString(),
                    expires_in_seconds: Math.floor(refreshExpiresIn),
                    expires_in_human: formatSeconds(Math.floor(refreshExpiresIn)),
                  },
                  warning_level: warningLevel,
                  user: tokenData.user || null,
                  recommendations: getRecommendations(refreshStatus, accessExpiresIn, refreshExpiresIn),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "start_auth_server": {
        // 启动授权服务器的工具
        const autoOpenBrowser = args.auto_open_browser !== false;
        const authServerPath = path.join(__dirname, "auth_server.js");

        if (!fs.existsSync(authServerPath)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: "未找到 auth_server.js 文件",
                    solution: "请确保 auth_server.js 存在于 MCP 服务器目录",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 构建启动命令
        const isWindows = process.platform === "win32";
        const command = isWindows ? "node" : "node";
        const authCommand = `cd "${__dirname}" && node auth_server.js`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "请按以下步骤完成授权",
                  auth_server_path: authServerPath,
                  auth_url: "http://localhost:3000",
                  quick_start: {
                    windows: `在新的终端/PowerShell 中运行:\n  cd "${__dirname}"\n  node auth_server.js`,
                    mac_linux: `在新的终端中运行:\n  cd "${__dirname}"\n  node auth_server.js`,
                  },
                  steps: [
                    "1. 在新的终端窗口中运行上述命令",
                    "2. 在浏览器打开 http://localhost:3000",
                    "3. 点击「打开授权页面」按钮",
                    "4. 在飞书页面点击「同意授权」",
                    "5. 自动跳转完成认证",
                  ],
                  note: "授权完成后，token 将自动保存到 user_token.json",
                  next_action: "授权完成后，使用 reload_user_token 工具加载新 token",
                  tip: "关闭授权服务器：在终端按 Ctrl+C",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "auto_auth": {
        // 使用 Puppeteer 自动授权
        const autoAuthPath = path.join(__dirname, "auto_auth.js");

        if (!fs.existsSync(autoAuthPath)) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: "未找到 auto_auth.js 文件",
                    solution: "请确保 auto_auth.js 存在于 MCP 服务器目录",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 检查 Puppeteer 是否安装
        try {
          require.resolve("puppeteer");
        } catch {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    error: "Puppeteer 未安装",
                    solution: "请运行: npm install puppeteer",
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 返回命令让用户在终端执行
        // 因为 Puppeteer 需要控制浏览器，在 MCP 环境中直接运行可能有问题
        const headless = args.headless || false;
        const autoLogin = args.auto_login !== false;

        const commandArgs = [];
        if (headless) commandArgs.push("--headless");
        if (!autoLogin) commandArgs.push("--no-auto-login");

        const command = `node auto_auth.js auto${commandArgs.length ? " " + commandArgs.join(" ") : ""}`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  message: "请在新终端中运行自动授权脚本",
                  script_path: autoAuthPath,
                  command: command,
                  alternative_npm: "npm run auth",
                  description: "自动授权功能说明",
                  features: [
                    "✓ 自动打开浏览器并访问飞书授权页面",
                    "✓ 支持保存 session，下次可自动登录",
                    "✓ 自动点击授权按钮",
                    "✓ 自动捕获授权码并交换 token",
                    "✓ 完成后自动保存 token",
                  ],
                  steps: [
                    "1. 打开新终端/PowerShell",
                    "2. 进入目录: cd " + __dirname,
                    "3. 运行命令: " + command,
                    "4. 首次需要手动登录飞书账号",
                    "5. 后续可使用保存的 session 自动登录",
                    "6. 授权完成后自动保存 token",
                  ],
                  options: {
                    headless: headless ? "无头模式（不显示浏览器）" : "显示浏览器窗口",
                    auto_login: autoLogin ? "使用保存的 session 自动登录" : "不使用自动登录",
                  },
                  note: "首次运行需要手动登录，之后会保存 session 实现完全自动化",
                  next_action: "授权完成后，使用 reload_user_token 工具加载新 token",
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    // 增强的错误处理 - 支持 HTTP 状态码细粒度处理
    let errorDetail = {
      success: false,
      tool: name,
      error: error.message,
      timestamp: new Date().toISOString(),
    };

    // 处理 Axios HTTP 错误（带响应状态码）
    if (error.response) {
      const httpStatus = error.response.status;
      errorDetail.http_status = httpStatus;

      // 使用预定义的 HTTP 错误处理器
      const errorHandler = HTTP_ERROR_HANDLERS[httpStatus];
      if (errorHandler) {
        errorDetail.error_type = errorHandler.error_type;
        errorDetail.solution = errorHandler.solution;
      } else {
        // 未定义的状态码
        errorDetail.error_type = 'http_error';
        errorDetail.solution = `HTTP 错误 (${httpStatus})，请稍后重试`;
      }
    }
    // 处理网络错误（请求发送但无响应）
    else if (error.request) {
      errorDetail.error_type = 'network_error';
      errorDetail.solution = '网络错误，请检查:\n' +
        '1. 网络连接是否正常\n' +
        '2. 防火墙设置\n' +
        '3. 代理配置\n' +
        '4. 飞书 API 服务是否可用';
    }
    // 处理特定业务逻辑错误（保留原有的错误检测）
    else {
      // 检查 Token 相关错误
      if (error.message.includes("未找到有效的用户 Token") ||
          error.message.includes("未找到用户 Token 文件")) {
        errorDetail.error_type = "no_user_token";
        errorDetail.solution = error.message;
      } else if (error.message.includes("Token 已过期")) {
        errorDetail.error_type = "token_expired";
        errorDetail.solution = error.message;
      } else {
        // 其他未知错误
        errorDetail.error_type = 'unknown_error';
        errorDetail.solution = '未知错误: ' + error.message + '\n请重试或联系技术支持';
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(errorDetail, null, 2),
        },
      ],
      isError: true,
    };
  }
});

// ==================== 资源列表 ====================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: "feishu://token/status",
        name: "Token 状态",
        description: "查看当前 tenant_access_token 的状态",
        mimeType: "application/json",
      },
      {
        uri: "feishu://app/info",
        name: "应用信息",
        description: "获取当前飞书应用的基本信息",
        mimeType: "application/json",
      },
    ],
  };
});

// ==================== 资源读取 ====================

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  try {
    switch (uri) {
      case "feishu://token/status":
        const token = await getTenantAccessToken();
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  token_exists: !!token,
                  expiry: new Date(tokenCache.expiry * 1000).toISOString(),
                  expires_in: Math.max(0, tokenCache.expiry - Date.now() / 1000),
                },
                null,
                2
              ),
            },
          ],
        };

      case "feishu://app/info":
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify(
                {
                  app_id: FEISHU_APP_ID,
                  app_id_configured: !!FEISHU_APP_ID,
                  app_secret_configured: !!FEISHU_APP_SECRET,
                  base_url: BASE_URL,
                },
                null,
                2
              ),
            },
          ],
        };

      default:
        throw new Error(`未知资源: ${uri}`);
    }
  } catch (error) {
    throw new Error(`读取资源失败: ${error.message}`);
  }
});

// ==================== 启动服务器 ====================

/**
 * 启动Token健康检查定时器（智能版）
 *
 * 安全说明：
 * - 每30秒只读取本地文件，不调用飞书API
 * - 只有在token即将过期（最后5分钟）时才调用刷新API
 * - 刷新成功后重置，不会再频繁调用
 * - 完全符合飞书API使用规范
 */
function startTokenHealthCheck() {
  let checkInterval = null;
  let lastApiCall = 0;  // 上次调用API的时间
  let lastActivityTime = Date.now();  // 上次有API活动的时间

  async function healthCheck() {
    try {
      if (!fs.existsSync(USER_TOKEN_FILE)) {
        return; // 没有token文件，跳过检查
      }

      const now = Date.now();
      const nowSec = now / 1000;
      const tokenData = JSON.parse(fs.readFileSync(USER_TOKEN_FILE, "utf8"));
      const remainingTime = tokenData.expires_at - nowSec;

      // 智能调整检查间隔
      let newInterval = TOKEN_HEALTH_CHECK_INTERVAL;

      if (SMART_CHECK_MODE) {
        const idleTime = (now - lastActivityTime) / 1000;  // 空闲时间（秒）

        if (remainingTime > 1800 && idleTime > 3600) {
          // Token还有30分钟以上 且 系统空闲超过1小时，降低检查频率
          newInterval = CHECK_INTERVALS.LONG_IDLE;
        } else if (remainingTime < TOKEN_REFRESH_ADVANCE && remainingTime > 0) {
          // Token即将过期（最后5分钟），提高检查频率
          newInterval = CHECK_INTERVALS.URGENT;
        } else {
          // 正常情况
          newInterval = CHECK_INTERVALS.NORMAL;
        }

        // 重启定时器使用新间隔
        if (checkInterval && newInterval !== TOKEN_HEALTH_CHECK_INTERVAL) {
          clearInterval(checkInterval);
          checkInterval = setInterval(healthCheck, newInterval * 1000);
        }
      }

      // Token即将过期（剩余时间小于刷新提前时间），主动刷新
      if (remainingTime > 0 && remainingTime < TOKEN_REFRESH_ADVANCE) {
        // 防止频繁刷新（至少间隔60秒）
        if (now - lastApiCall > 60000) {
          console.error(`[Token健康检查] Token即将过期（剩余${Math.floor(remainingTime)}秒），主动刷新中...`);
          await refreshUserToken(tokenData);
          lastApiCall = now;
          lastActivityTime = now;
        }
      }
      // Token已过期
      else if (remainingTime <= 0) {
        console.error("[Token健康检查] Token已过期，需要重新认证");
        console.error("请运行: node auth_server.js");
      }
    } catch (error) {
      console.error(`[Token健康检查] 检查失败: ${error.message}`);
    }
  }

  // 启动定时检查
  checkInterval = setInterval(healthCheck, TOKEN_HEALTH_CHECK_INTERVAL * 1000);

  // 立即执行一次检查
  healthCheck();

  const modeText = SMART_CHECK_MODE ? "（智能模式）" : "";
  console.error(`[Token健康检查] 已启动${modeText}，初始每${TOKEN_HEALTH_CHECK_INTERVAL}秒检查一次`);
  console.error("[Token安全提示] 检查只读本地文件，刷新仅在最后5分钟触发，符合飞书API规范");

  return {
    interval: checkInterval,
    updateActivity: () => { lastActivityTime = Date.now(); }
  };
}

async function main() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.error("错误: 请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量");
    process.exit(1);
  }

  // 添加优雅关闭处理
  const shutdown = async (signal) => {
    console.error(`\n收到 ${signal} 信号，正在关闭服务器...`);

    // 清理 Token 缓存（防止内存泄漏）
    clearUserTokenCache();

    // 停止健康检查定时器
    if (userTokenCache.refreshTimer) {
      clearTimeout(userTokenCache.refreshTimer);
    }

    console.error("服务器已安全关闭");
    process.exit(0);
  };

  // 监听退出信号
  process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
  process.on('SIGTERM', () => shutdown('SIGTERM')); // kill 命令
  process.on('exit', () => {
    // 进程退出时的清理（同步）
    if (userTokenCache.refreshTimer) {
      // 注意：这里无法异步清理，只能防止崩溃
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("飞书企业级 MCP 服务器已启动");

  // 启动Token健康检查定时器
  startTokenHealthCheck();
}

main().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});
