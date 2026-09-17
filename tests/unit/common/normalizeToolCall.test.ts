import { describe, expect, it } from 'vitest';
import type { IMessageAcpToolCall, IMessageToolCall, IMessageToolGroup, TMessage } from '@/common/chat/chatLib';
import { finalizeOrphanedToolMessages, normalizeAcpToolCall } from '@/common/chat/normalizeToolCall';

describe('normalizeToolCall', () => {
  it('normalizes compact snake_case acp tool calls from history responses', () => {
    const result = normalizeAcpToolCall({
      id: 'message-1',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        _compact: {
          truncated: true,
          original_size: 90000,
          preview_chars: 4096,
        },
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-1',
          status: 'completed',
          title: 'rg',
          kind: 'search',
          raw_input: { pattern: 'needle', path: '.' },
          content: [{ type: 'content', content: { type: 'text', text: 'preview' } }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result).toMatchObject({
      key: 'tool-1',
      name: 'rg',
      status: 'completed',
      description: '"needle" in .',
      output: 'preview',
      truncated: true,
      messageId: 'message-1',
      conversationId: 'conversation-1',
    });
  });

  it('ignores malformed ACP content items in compact history output', () => {
    const result = normalizeAcpToolCall({
      id: 'message-2',
      conversation_id: 'conversation-1',
      type: 'acp_tool_call',
      content: {
        update: {
          session_update: 'tool_call',
          tool_call_id: 'tool-2',
          status: 'completed',
          title: 'Edit file',
          kind: 'edit',
          content: [null, 'invalid', { type: 'diff', path: '/workspace/file.ts', old_text: 'old', new_text: 'new' }],
        },
      },
    } as unknown as IMessageAcpToolCall);

    expect(result?.output).toBe('[diff] /workspace/file.ts');
  });
});

describe('finalizeOrphanedToolMessages', () => {
  it('returns the input untouched while the turn is active (long tool calls stay live)', () => {
    const messages = [
      {
        id: 'm1',
        type: 'tool_call',
        content: { call_id: 'c1', name: 'Glob', args: {}, status: 'running' },
      },
    ] as unknown as TMessage[];
    expect(finalizeOrphanedToolMessages(messages, true)).toBe(messages);
  });

  it('finalizes orphaned tool_call records as canceled when the turn is not active', () => {
    const result = finalizeOrphanedToolMessages(
      [
        { id: 'm1', type: 'tool_call', content: { call_id: 'c1', name: 'ExecCommand', args: {}, status: 'running' } },
        { id: 'm2', type: 'tool_call', content: { call_id: 'c2', name: 'Glob', args: {} } },
        { id: 'm3', type: 'tool_call', content: { call_id: 'c3', name: 'Read', args: {}, status: 'completed' } },
      ] as unknown as TMessage[],
      false
    );
    expect((result[0] as IMessageToolCall).content.status).toBe('canceled');
    expect((result[1] as IMessageToolCall).content.status).toBe('canceled');
    expect((result[2] as IMessageToolCall).content.status).toBe('completed');
  });

  it('finalizes non-terminal tool_group items but keeps terminal ones and identity', () => {
    const terminalGroup = {
      id: 'g1',
      type: 'tool_group',
      content: [{ call_id: 'k1', name: 'Bash', description: '', render_output_as_markdown: false, status: 'Success' }],
    } as unknown as TMessage;
    const orphanGroup = {
      id: 'g2',
      type: 'tool_group',
      content: [
        { call_id: 'k2', name: 'Glob', description: '', render_output_as_markdown: false, status: 'Executing' },
        { call_id: 'k3', name: 'Bash', description: '', render_output_as_markdown: false, status: 'Confirming' },
        { call_id: 'k4', name: 'Grep', description: '', render_output_as_markdown: false, status: 'Pending' },
      ],
    } as unknown as TMessage;
    const result = finalizeOrphanedToolMessages([terminalGroup, orphanGroup], false);
    // terminal group untouched — same reference (copy-on-write)
    expect(result[0]).toBe(terminalGroup);
    const finalized = (result[1] as IMessageToolGroup).content.map((item) => item.status);
    expect(finalized).toEqual(['Canceled', 'Canceled', 'Canceled']);
  });

  it('finalizes orphaned acp_tool_call records as canceled', () => {
    const result = finalizeOrphanedToolMessages(
      [
        {
          id: 'a1',
          type: 'acp_tool_call',
          content: { update: { tool_call_id: 't1', status: 'in_progress', title: 'rg', kind: 'search' } },
        },
        {
          id: 'a2',
          type: 'acp_tool_call',
          content: { update: { tool_call_id: 't2', status: 'completed', title: 'Edit', kind: 'edit' } },
        },
      ] as unknown as TMessage[],
      false
    );
    expect((result[0] as IMessageAcpToolCall).content.update.status).toBe('canceled');
    expect((result[1] as IMessageAcpToolCall).content.update.status).toBe('completed');
  });

  it('passes non-tool messages through unchanged', () => {
    const text = { id: 't1', type: 'text', content: { content: 'hello' } } as unknown as TMessage;
    const result = finalizeOrphanedToolMessages([text], false);
    expect(result[0]).toBe(text);
  });
});
