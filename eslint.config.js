/**
 * ESLint 配置 - 飞书企业级 MCP 服务器
 * 使用 ESLint 9+ 平面配置格式
 */

import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Node.js 全局变量
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Jest 测试全局变量
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        jest: 'readonly',
      },
    },
    rules: {
      // 代码质量规则
      'no-console': 'off', // 允许 console（用于调试）
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }], // 未使用变量警告
      'no-throw-literal': 'error', // 禁止抛出字面量
      'prefer-promise-reject-errors': 'error', // Promise reject 应该是 Error 对象
      'no-var': 'error', // 禁止 var，使用 const/let
      'eqeqeq': ['error', 'always'], // 使用 === 而非 ==
      'curly': ['error', 'all'], // 所有控制语句必须使用大括号

      // ES6 规则
      'arrow-body-style': ['error', 'as-needed'], // 箭头函数体样式
      'arrow-parens': ['error', 'as-needed'], // 箭头函数参数括号

      // 异步规则
      'require-await': 'error', // async 函数必须有 await
      'no-return-await': 'error', // 不必要的 await

      // 安全规则
      'no-eval': 'error', // 禁止 eval
      'no-implied-eval': 'error', // 禁止隐式 eval
      'no-new-func': 'error', // 禁止 new Function

      // 注释规则
      'no-warning-comments': 'off', // 允许 TODO/FIXME 注释
    },
  },
  {
    files: ['tests/**/*.test.js'],
    rules: {
      // 测试文件可以宽松一些
      'no-unused-vars': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      'dist/**',
      '*.config.js',
    ],
  },
];
