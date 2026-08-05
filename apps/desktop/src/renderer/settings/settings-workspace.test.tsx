import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  SettingsWorkspace,
  type SettingsTopic,
  type SettingsTopicContent,
} from './settings-workspace.js';

const topicContent: SettingsTopicContent = {
  provider: <div data-testid="provider-content">provider content</div>,
  model: <div data-testid="model-content">model content</div>,
  mcp: <div data-testid="mcp-content">mcp content</div>,
  acp: <div data-testid="acp-content">acp content</div>,
  audit: <div data-testid="audit-content">audit content</div>,
};

type ElementLike = ReactElement<{
  children?: ReactNode;
  onClick?: () => void;
  'data-testid'?: string;
}>;

function findElementByText(node: ReactNode, text: string): ElementLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByText(child, text);
      if (match !== undefined) return match;
    }
    return undefined;
  }

  if (node === null || typeof node !== 'object' || !('props' in node)) return undefined;

  const element = node as ElementLike;
  if (
    element.props.children === text ||
    (Array.isArray(element.props.children) &&
      element.props.children.filter((child) => typeof child === 'string').join('') === text)
  ) {
    return element;
  }
  return findElementByText(element.props.children, text);
}

function findElementByTestId(node: ReactNode, testId: string): ElementLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByTestId(child, testId);
      if (match !== undefined) return match;
    }
    return undefined;
  }

  if (node === null || typeof node !== 'object' || !('props' in node)) return undefined;

  const element = node as ElementLike;
  if (element.props['data-testid'] === testId) return element;
  return findElementByTestId(element.props.children, testId);
}

function renderWorkspace(activeTopic?: SettingsTopic): string {
  const props = {
    onBack: () => undefined,
    onTopicChange: () => undefined,
    topicContent,
  };

  return activeTopic === undefined
    ? renderToStaticMarkup(<SettingsWorkspace {...props} />)
    : renderToStaticMarkup(<SettingsWorkspace {...props} activeTopic={activeTopic} />);
}

describe('SettingsWorkspace', () => {
  it('renders the grouped navigation in order and defaults to Provider content', () => {
    const markup = renderWorkspace();

    expect(markup).toContain('设置工作区');
    expect(markup).toContain('返回工作区');
    expect(markup).toMatch(/<img[^>]*alt="Synapse Term logo"/);
    expect(markup).toContain('provider-content');
    expect(markup).not.toContain('model-content');

    const orderedLabels = [
      '配置',
      '服务商配置',
      '模型配置',
      '外部接入',
      'MCP 服务',
      'ACP 集成',
      '安全与诊断',
      '审计日志',
    ];
    const positions = orderedLabels.map((label) => markup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(markup).toContain('data-testid="settings-group-provider"');
    expect(markup).toContain('data-testid="settings-group-mcp"');
    expect(markup).toContain('data-testid="settings-group-audit"');
  });

  it('routes top-level groups to their default topic', () => {
    const onTopicChange = vi.fn<(topic: SettingsTopic) => void>();
    const tree = SettingsWorkspace({
      activeTopic: 'model',
      onBack: () => undefined,
      onTopicChange,
      topicContent,
    });

    const configurationButton = findElementByTestId(tree, 'settings-group-provider');
    const externalButton = findElementByTestId(tree, 'settings-group-mcp');
    const diagnosticsButton = findElementByTestId(tree, 'settings-group-audit');

    expect(configurationButton?.type).toBe('button');
    expect(externalButton?.type).toBe('button');
    expect(diagnosticsButton?.type).toBe('button');

    configurationButton?.props.onClick?.();
    externalButton?.props.onClick?.();
    diagnosticsButton?.props.onClick?.();

    expect(onTopicChange.mock.calls).toEqual([['provider'], ['mcp'], ['audit']]);
  });

  it('routes topic selection through the callback while keeping navigation visible', () => {
    const onTopicChange = vi.fn<(topic: SettingsTopic) => void>();
    const tree = SettingsWorkspace({
      activeTopic: 'provider',
      onBack: () => undefined,
      onTopicChange,
      topicContent,
    });
    const modelButton = findElementByText(tree, '模型配置');

    expect(modelButton?.props.onClick).toBeTypeOf('function');
    modelButton?.props.onClick?.();
    expect(onTopicChange).toHaveBeenCalledWith('model');

    const markup = renderWorkspace('model');
    expect(markup).toContain('model-content');
    expect(markup).not.toContain('provider-content');
    expect(markup).toContain('服务商配置');
    expect(markup).toContain('审计日志');
  });

  it('routes the return action through the provided callback', () => {
    const onBack = vi.fn();
    const tree = SettingsWorkspace({
      activeTopic: 'audit',
      onBack,
      onTopicChange: () => undefined,
      topicContent,
    });
    const backButton = findElementByText(tree, '返回工作区');

    expect(backButton?.props.onClick).toBeTypeOf('function');
    backButton?.props.onClick?.();
    expect(onBack).toHaveBeenCalledOnce();
  });
});
