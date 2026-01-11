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
const FEISHU_APP_ID = process.env.FEISHU_APP_ID || "";
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || "";

// Token 缓存
let tokenCache = {
  token: null,
  expiry: 0,
};

// 用户 Token 缓存
let userTokenCache = {
  token: null,
  expiry: 0,
};

// Token 文件路径
const USER_TOKEN_FILE = path.join(__dirname, "user_token.json");

// ==================== 工具函数 ====================

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
 * 获取 user_access_token（从文件读取）
 */
async function getUserAccessToken() {
  const now = Date.now() / 1000;

  // 检查缓存
  if (userTokenCache.token && now < userTokenCache.expiry) {
    return userTokenCache.token;
  }

  // 从文件读取
  if (fs.existsSync(USER_TOKEN_FILE)) {
    const tokenData = JSON.parse(fs.readFileSync(USER_TOKEN_FILE, "utf8"));

    // 检查是否有效
    if (tokenData.expires_at > now) {
      userTokenCache = {
        token: tokenData.access_token,
        expiry: tokenData.expires_at,
      };
      return userTokenCache.token;
    }

    // Token 过期，尝试刷新
    if (tokenData.refresh_token) {
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
          }
        );

        if (response.data.code === 0) {
          const newTokenData = response.data.data;
          const expiresAt = now + newTokenData.expires_in;

          // 更新文件
          const updatedData = {
            ...tokenData,
            access_token: newTokenData.access_token,
            refresh_token: newTokenData.refresh_token || tokenData.refresh_token,
            expires_at: expiresAt,
          };
          fs.writeFileSync(USER_TOKEN_FILE, JSON.stringify(updatedData, null, 2));

          userTokenCache = {
            token: newTokenData.access_token,
            expiry: expiresAt,
          };

          console.error("✓ 用户 Token 已刷新");
          return userTokenCache.token;
        }
      } catch (e) {
        console.error("刷新 Token 失败:", e.message);
      }
    }
  }

  throw new Error(
    "未找到有效的用户 Token。请先运行用户认证:\n" +
    '  1. 运行: node auth_server.js\n' +
    "  2. 在浏览器中完成授权\n" +
    "  3. 重试当前操作"
  );
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
            obj_type: {
              type: "string",
              description: "节点类型: document(文档) 或 folder(文件夹)",
              enum: ["document", "folder"],
              default: "document",
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
        // 1. 创建空白文档
        const createResult = await feishuRequest("POST", "/docx/v1/documents", {
          folder_token: args.folder_token,
          title: args.title,
        });

        const documentId = createResult.data.document.document_id;
        const documentUrl = createResult.data.document.url;

        // 2. 获取初始块
        const blocksResult = await feishuRequest(
          "GET",
          `/docx/v1/documents/${documentId}/blocks`
        );
        const firstBlockId = blocksResult.data.items[0]?.block_id;

        if (firstBlockId && args.content) {
          // 3. 添加内容
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
            { children }
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
          { page_size: 500 }
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
        // 获取文档块列表
        const blocksResult = await feishuRequest(
          "GET",
          `/docx/v1/documents/${args.document_id}/blocks`
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
          { children }
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
          params
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
        const result = await feishuRequest(
          "POST",
          `/wiki/v2/spaces/${args.space_id}/nodes`,
          {
            parent_node_token: args.parent_node_token || "",
            title: args.title,
            obj_type: args.obj_type || "document",
          },
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
        const params = {};
        if (args.space_id) {
          params.space_id = args.space_id;
        }

        const result = await feishuRequest(
          "GET",
          `/wiki/v2/nodes/${args.token}`,
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
          params
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
          { fields: args.fields }
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
          { fields: args.fields }
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
        let content = args.content;
        if (args.msg_type === "text") {
          content = JSON.stringify({ text: args.content });
        }

        const result = await feishuRequest("POST", "/message/v4/send", {
          receive_id_type: args.receive_id_type || "open_id",
          receive_id: args.receive_id,
          msg_type: args.msg_type || "text",
          content: content,
        });

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
          `/calendar/v4/calendars/${args.calendar_id}/events`,
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
          }
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
          `/calendar/v4/calendars/${args.calendar_id}/events/${args.event_id}`
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
            params
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
      }

      case "create_folder": {
        const result = await feishuRequest("POST", "/drive/v1/files", {
          type: "folder",
          name: args.name,
          parent_token: args.parent_token || "",
        });

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
        const result = await feishuRequest(
          "GET",
          `/drive/v1/${args.type}/${args.token}`
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
          { user_id_type: args.user_id_type || "open_id" }
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
          }
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

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: false,
              error: error.message,
            },
            null,
            2
          ),
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

async function main() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.error("错误: 请设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET 环境变量");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("飞书企业级 MCP 服务器已启动");
}

main().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});
