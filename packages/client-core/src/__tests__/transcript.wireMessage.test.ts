import { describe, expect, it } from 'vitest';
import { buildTranscriptTurns, transcriptMessageInput, chatMessageToBlocks, messageAttachments, messageWasStopped, wireChatMessageToBlocks } from '../transcript/index.js';
describe('wire transcript input', () => {
  it('groups projected wire messages without manufacturing transport fields', () => {
    const messages = [
      { id: 'u', role: 'user' as const, ...transcriptMessageInput({ content: 'hello' }) },
      { id: 'a', role: 'assistant' as const, ...transcriptMessageInput({ content: '', metadata: { partial: true } }) },
      { id: 'empty', role: 'assistant' as const, ...transcriptMessageInput({ content: '' }) },
    ];
    const turns = buildTranscriptTurns(messages, { pendingUserText: 'next', live: true });
    expect(turns.map(turn => turn.entries.map(entry => entry.key))).toEqual([['u', 'a'], ['pending-user', 'live-turn']]);
    expect(turns[0]?.entries[0]).toMatchObject({ message: messages[0] });
    expect(turns[1]?.live).toBe(true);
    expect(messages[0]).not.toHaveProperty('timestamp');
    expect(messages[0]).not.toHaveProperty('sessionId');
  });
  it('requires neither invented timestamps nor session ids', () => {
    expect(chatMessageToBlocks({content: 'answer'})).toEqual([{type: 'text',blockId: 0,content: 'answer'}]);
  });
  it('uses the shared ordinal sort and avoids repeating final content', () => {
    const blocks = wireChatMessageToBlocks({content:'done',metadata:{
      toolCalls:[{id:'x',tool:'Bash',status:'error',sequence:2,result:'failure'}],
      textSegments:[{content:'before',sequence:1},{content:'done',sequence:3}],
    }});
    expect(blocks.map(b=>b.type)).toEqual(['text','tool_call','text']);
    expect(blocks[1]).toMatchObject({callId:'x',status:'complete',error:true});
  });
  it('ignores malformed array entries and expires historical gates', () => {
    const blocks = wireChatMessageToBlocks({content:'',metadata:{toolCalls:[null,2,{}, {tool:'Read'}],
      planCards:[{planId:'p',status:'awaiting_review'}],questionCards:[{interactionId:'q',status:'pending'}],
      permissionCards:[{interactionId:'g',status:'pending'}]}});
    expect(blocks.map(b=>b.type)).toEqual(['tool_call','plan','question','permission']);
    for(const block of blocks.slice(1)) expect(block).toMatchObject({status:'expired'});
  });
  it('keeps a settled permission card\'s risk verdict (MG-04)', () => {
    const [block] = wireChatMessageToBlocks({content:'',metadata:{permissionCards:[{interactionId:'g',status:'allowed',risk:'risky'}]}});
    expect(block).toMatchObject({type:'permission',status:'allowed',risk:'risky'});
  });
  it('preserves optional attachment metadata and stopped turns', () => {
    expect(messageAttachments({attachments:[{}, {name:'image',path:'a.png',artifactId:'a'}]})).toEqual([{name:'image',path:'a.png',artifactId:'a'}]);
    expect(messageWasStopped({metadata:{partial:true}})).toBe(true);
    expect(messageWasStopped({metadata:{partial:'true'}})).toBe(false);
  });
});
