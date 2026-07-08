// @ts-check
import eslint from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['.angular/**', 'dist/**', 'coverage/**', 'node_modules/**', 'tmp-screenshots/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    plugins: {
      '@stylistic': stylistic,
    },
    processor: angular.processInlineTemplates,
    rules: {
      'no-undef': 'off',
      curly: ['error', 'all'],
      '@stylistic/block-spacing': ['error', 'always'],
      '@stylistic/indent': ['error', 4],
      '@stylistic/max-len': [
        'error',
        {
          code: 100
        }
      ],
      '@stylistic/object-curly-spacing': ['error', 'always'],
      '@stylistic/spaced-comment': ['error', 'always'],
      '@stylistic/comma-dangle': ['error', 'never'],
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: 'return'
        }
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        {
          accessibility: 'explicit',
          overrides: {
            constructors: 'no-public'
          }
        }
      ],
      '@typescript-eslint/member-ordering': [
        'error',
        {
          default: [
            'signature',
            'public-static-field',
            'protected-static-field',
            'private-static-field',
            'public-instance-field',
            'protected-instance-field',
            'private-instance-field',
            'constructor',
            'public-decorated-method',
            'protected-decorated-method',
            'private-decorated-method',
            'public-instance-method',
            'protected-instance-method',
            'private-instance-method'
          ]
        }
      ],
      '@typescript-eslint/no-invalid-void-type': [
        'error',
        {
          allowInGenericTypeArguments: ['Promise', 'Observable'],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'pr',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'pr',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/elements-content': 'off',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'warn',
    },
  },
);
