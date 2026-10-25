import test from 'node:test';
import assert from 'node:assert/strict';
import { Budget } from '../src/tools/budget.js';
import { ToolState, executeTool } from '../src/tools/executor.js';
import { MockGoofishProvider } from '../src/goofish/mock.js';
import { silentLogger, tempDir, testConfig, testSettings } from './helpers.js';

test('executor: повторная карточка не запрашивается', async () => {
  const dir = tempDir();
  const config = testConfig(dir);
  const settings = testSettings(dir);
  const provider = new MockGoofishProvider({ logger: silentLogger() });
  let calls = 0;
  const original = provider.item.bind(provider);
  provider.item = async (id) => { calls += 1; return original(id); };
  const state = new ToolState({ provider, settings: settings.get(), budget: new Budget(10), config, logger: silentLogger() });
  const first = await executeTool('goofish_item', { item_id: '812345678901' }, state);
  const second = await executeTool('goofish_item', { item_id: '812345678901' }, state);
  assert.match(first.text, /КАРТОЧКА/);
  assert.match(second.text, /уже запрашивалась/);
  assert.equal(calls, 1);
});
