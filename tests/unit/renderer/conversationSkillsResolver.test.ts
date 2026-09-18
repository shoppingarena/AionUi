import { describe, expect, it } from 'vitest';
import {
  LEGACY_SKILL_SNAPSHOT_MARKER,
  isStaleConversationSkillSnapshot,
  resolveAssistantEffectiveSkills,
} from '@/renderer/hooks/conversation/useResolvedConversationSkills';
import { resolveAssistantConfigId } from '@/renderer/hooks/agent/usePresetAssistantInfo';

describe('isStaleConversationSkillSnapshot', () => {
  it('flags legacy snapshots that still carry the removed aionui-skills pseudo-skill', () => {
    expect(isStaleConversationSkillSnapshot(['aionui-skills', 'cron', 'officecli', 'skill-creator'])).toBe(true);
  });
  it('treats empty and missing snapshots as stale', () => {
    expect(isStaleConversationSkillSnapshot(undefined)).toBe(true);
    expect(isStaleConversationSkillSnapshot([])).toBe(true);
  });
  it('trusts fresh fully-populated snapshots', () => {
    expect(
      isStaleConversationSkillSnapshot(['aionui-config', 'cron', 'officecli', 'session-message', 'skill-creator'])
    ).toBe(false);
  });
});

describe('resolveAssistantEffectiveSkills', () => {
  it('unions default ids with auto-inject builtins (editor formula)', () => {
    const autoInject = [
      'aionui-config',
      'conversation-create',
      'cron',
      'officecli',
      'session-message',
      'skill-creator',
    ];
    const defaults = ['pdf', 'math-logic', 'officecli-xlsx'];
    const resolved = resolveAssistantEffectiveSkills(defaults, autoInject, []);
    expect(resolved).toEqual([
      'pdf',
      'math-logic',
      'officecli-xlsx',
      'aionui-config',
      'conversation-create',
      'cron',
      'officecli',
      'session-message',
      'skill-creator',
    ]);
  });
  it('excludes disabled builtin skills', () => {
    const resolved = resolveAssistantEffectiveSkills(['pdf'], ['officecli', 'cron'], ['cron']);
    expect(resolved).toEqual(['pdf', 'officecli']);
  });
  it('deduplicates overlapping names', () => {
    const resolved = resolveAssistantEffectiveSkills(['officecli', 'pdf'], ['officecli', 'cron'], []);
    expect(resolved).toEqual(['officecli', 'pdf', 'cron']);
  });
  it('exports the legacy marker constant', () => {
    expect(LEGACY_SKILL_SNAPSHOT_MARKER).toBe('aionui-skills');
  });
});

describe('resolveAssistantConfigId null-safety', () => {
  it('returns null for undefined/null conversations instead of crashing on extra (#black-page)', () => {
    expect(resolveAssistantConfigId(undefined)).toBeNull();
    expect(resolveAssistantConfigId(null)).toBeNull();
  });
  it('reads assistant ids from a real conversation', () => {
    expect(
      resolveAssistantConfigId({ extra: { assistant_id: 'custom-1', preset_assistant_id: 'builtin-2' } } as never)
    ).toBe('custom-1');
    expect(resolveAssistantConfigId({ extra: { preset_assistant_id: 'builtin-2' } } as never)).toBe('builtin-2');
    expect(resolveAssistantConfigId({ extra: {} } as never)).toBeNull();
  });
});
