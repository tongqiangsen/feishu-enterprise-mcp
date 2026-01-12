/**
 * Feishu MCP Server - 工具函数单元测试
 */

import {
  cleanExpiredCache,
  generateCacheKey,
  getCachedData,
  setCachedData,
  validateStringLength,
  validateToken,
  validateTitle,
  validateContent
} from '../index.js';

describe('缓存工具函数', () => {
  beforeEach(() => {
    // 清空缓存
    const { REQUEST_CACHE } = await import('../index.js');
    REQUEST_CACHE.clear();
  });

  test('generateCacheKey 生成正确的缓存键', () => {
    const key1 = generateCacheKey('GET', '/api/v1/test', { a: '1', b: '2' });
    const key2 = generateCacheKey('GET', '/api/v1/test', { b: '2', a: '1' });
    const key3 = generateCacheKey('POST', '/api/v1/test', { a: '1' });

    expect(key1).toBe(key2); // 参数顺序不影响
    expect(key1).not.toBe(key3); // 不同方法生成不同键
  });

  test('缓存设置和获取', async () => {
    const testData = { code: 0, data: 'test' };
    await setCachedData('GET', '/api/test', null, testData);
    const cached = await getCachedData('GET', '/api/test', null);

    expect(cached).toEqual(testData);
  });

  test('缓存TTL过期', async () => {
    jest.useFakeTimers();

    const testData = { code: 0, data: 'test' };
    await setCachedData('GET', '/api/test', null, testData);

    // 快进31秒（超过30秒TTL）
    jest.advanceTimersByTime(31000);

    const cached = await getCachedData('GET', '/api/test', null);
    expect(cached).toBeNull();

    jest.useRealTimers();
  });
});

describe('输入验证函数', () => {
  test('validateStringLength 验证通过', () => {
    expect(validateStringLength('test', 10, 'field')).toBe('test');
  });

  test('validateStringLength 长度超限', () => {
    expect(() => {
      validateStringLength('a'.repeat(11), 10, 'field');
    }).toThrow('field 长度超过限制');
  });

  test('validateStringLength 非字符串', () => {
    expect(() => {
      validateStringLength(123, 10, 'field');
    }).toThrow('field 必须是字符串类型');
  });

  test('validateToken 验证通过', () => {
    expect(validateToken('valid_token_123')).toBe('valid_token_123');
  });

  test('validateToken 包含非法字符', () => {
    expect(() => {
      validateToken('invalid@token#123');
    }).toThrow('Token 格式无效');
  });

  test('validateTitle 清理危险字符', () => {
    expect(validateTitle('<script>alert("xss")</script>title'))
      .toBe('alert("xss")title');
  });

  test('validateContent 长度验证', () => {
    const longContent = 'a'.repeat(100001);
    expect(() => {
      validateContent(longContent);
    }).toThrow('内容 长度超过限制');
  });
});

describe('HTTP错误处理器', () => {
  test('HTTP_ERROR_HANDLERS 包含正确的状态码', async () => {
    const { HTTP_ERROR_HANDLERS } = await import('../index.js');

    expect(HTTP_ERROR_HANDLERS).toHaveProperty('400');
    expect(HTTP_ERROR_HANDLERS).toHaveProperty('403');
    expect(HTTP_ERROR_HANDLERS).toHaveProperty('404');
    expect(HTTP_ERROR_HANDLERS).toHaveProperty('429');
    expect(HTTP_ERROR_HANDLERS).toHaveProperty('500');

    expect(HTTP_ERROR_HANDLERS[400].error_type).toBe('invalid_request');
    expect(HTTP_ERROR_HANDLERS[403].error_type).toBe('permission_denied');
  });
});
