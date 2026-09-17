/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';
import { ipcBridge } from '@/common';
import type { TChatConversation } from '@/common/config/storage';
import { resolveLocaleKey } from '@/common/utils';
import { resolveAssistantConfigId } from '@/renderer/hooks/agent/usePresetAssistantInfo';
import { resolveGuidAssistantDefaults } from '@/renderer/pages/guid/utils/assistantDefaults';

/**
 * Removed legacy pseudo-skill carried by pre-rework conversation snapshots.
 * The `extra.skills` snapshot is written once at creation time and is
 * immutable post-creation (backend rejects rewriting it), so old
 * conversations keep a stale snapshot that lists `aionui-skills` plus only
 * the then-active default set — far fewer than the assistant's current
 * definition. Presence of this marker means "legacy snapshot, re-resolve".
 */
export const LEGACY_SKILL_SNAPSHOT_MARKER = 'aionui-skills';

const isLegacySnapshot = (snapshot: string[]): boolean => snapshot.includes(LEGACY_SKILL_SNAPSHOT_MARKER);

export type ConversationSkillSnapshot = string[] | undefined;

/**
 * Pure: detectable stale/legacy snapshot. Used by the hook and by tests to
 * decide whether `extra.skills` needs re-resolution against the assistant.
 */
export const isStaleConversationSkillSnapshot = (snapshot: ConversationSkillSnapshot): boolean =>
  !snapshot || snapshot.length === 0 || isLegacySnapshot(snapshot);

/**
 * Pure: recompute the effective skills for an assistant from its live default
 * skill ids plus the auto-inject builtin skills (minus disabled). Mirrors the
 * assistant editor's `selectedSkills ∪ builtinAutoSkills − disabledBuiltinSkills`
 * so stale legacy snapshots display exactly what the assistant page shows.
 */
export const resolveAssistantEffectiveSkills = (
  skillIds: string[],
  autoInjectSkillNames: string[],
  disabledBuiltinSkillIds: string[]
): string[] => {
  const disabled = new Set(disabledBuiltinSkillIds);
  return [...new Set([...skillIds, ...autoInjectSkillNames.filter((name) => !disabled.has(name))])];
};

/**
 * Read-time reconciliation of a conversation's skill snapshot against the
 * assistant's live definition.
 *
 * The backend writes `conversation.extra.skills` once at creation and refuses
 * to mutate it afterwards. Fresh conversations already carry the correct
 * fully-populated list (defaults + auto-inject), but legacy conversations
 * snapshot only the old pseudo-skill `aionui-skills` + a minimal default set.
 * This hook detects that legacy marker (or a missing snapshot) and re-resolves
 * the effective skills from the assistant's current definition, matching what
 * the assistant editor shows. It returns the snapshot verbatim when it is
 * already authoritative.
 */
export function useResolvedConversationSkills(conversation: TChatConversation | undefined): {
  skills: string[] | undefined;
  isLoading: boolean;
} {
  const { i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language || 'en-US');

  const snapshot = useMemo(() => (conversation?.extra as { skills?: string[] } | undefined)?.skills, [conversation]);

  const assistantId = conversation?.assistant?.id ?? resolveAssistantConfigId(conversation);
  const needsResolution = Boolean(assistantId) && (!snapshot || snapshot.length === 0 || isLegacySnapshot(snapshot));

  const { data: detail, isLoading: isLoadingDetail } = useSWR(
    needsResolution && assistantId ? `guid.assistant.detail.${assistantId}.${localeKey}` : null,
    () => (assistantId ? ipcBridge.assistants.get.invoke({ id: assistantId, locale: localeKey }) : null)
  );

  const { data: skillIndex, isLoading: isLoadingSkills } = useSWR(needsResolution ? 'skills-index' : null, () =>
    ipcBridge.fs.listAvailableSkills.invoke()
  );

  return useMemo(() => {
    if (!needsResolution) return { skills: snapshot, isLoading: false };

    if (!detail || !skillIndex) {
      return { skills: snapshot, isLoading: isLoadingDetail || isLoadingSkills };
    }

    const { skillIds, disabledBuiltinSkillIds } = resolveGuidAssistantDefaults(detail);
    const autoInjectNames = skillIndex.filter((s) => s.source === 'builtin' && s.is_auto_inject).map((s) => s.name);

    return {
      skills: resolveAssistantEffectiveSkills(skillIds, autoInjectNames, disabledBuiltinSkillIds),
      isLoading: false,
    };
  }, [needsResolution, snapshot, detail, skillIndex, isLoadingDetail, isLoadingSkills]);
}
