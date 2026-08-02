/** Agent 面板宽度计算（自 app.tsx 拆分） */

export const AGENT_PANEL_MIN_WIDTH = 360;
export const AGENT_PANEL_MAX_WIDTH = 720;
export const TERMINAL_MIN_WIDTH = 360;

export function getViewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

export function getDefaultAgentPanelWidth(): number {
  return getViewportWidth() >= 1280 ? 550 : 480;
}

export function getAgentPanelMaxWidth(workspaceWidth: number): number {
  return Math.max(
    AGENT_PANEL_MIN_WIDTH,
    Math.min(AGENT_PANEL_MAX_WIDTH, workspaceWidth - TERMINAL_MIN_WIDTH),
  );
}

export function clampAgentPanelWidth(width: number, workspaceWidth: number): number {
  const maxWidth = getAgentPanelMaxWidth(workspaceWidth);
  return Math.round(Math.min(maxWidth, Math.max(AGENT_PANEL_MIN_WIDTH, width)));
}
