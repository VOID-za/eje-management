import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RepairItemsEditor,
  repairItemDrafts,
  repairItemsFromDrafts,
  type RepairItemDraft,
} from './RepairItemsEditor';
import type { RepairItem } from '@/domain';

/**
 * TR-PARTS-ORDER-1 (8 November 2026): PARTS BOOKED IN READ Part number,
 * Description, Quantity.
 *
 * Order in the MARKUP is what decides both the screen and the keyboard: the
 * fields are plain inputs in document order with no `tabindex` and no CSS
 * `order`, so the first input is the first tab stop and the first field a
 * phone stacks. And moving them must not move a value: each input still writes
 * its own property, and a list saved and reopened comes back as it went in.
 */
const noop = (): void => undefined;

const draft = (over: Partial<RepairItemDraft>): RepairItemDraft => ({
  key: 1,
  partNumber: '',
  description: '',
  quantity: '',
  ...over,
});

const render = (drafts: readonly RepairItemDraft[]): string =>
  renderToStaticMarkup(createElement(RepairItemsEditor, { drafts, onChange: noop }));

const fieldOrder = (html: string): readonly string[] =>
  [...html.matchAll(/data-testid="repair-item-(part-number|description|quantity)"/gu)].map((match) => match[1]!);

describe('the parts booked in', () => {
  it('reads Part number, Description, Quantity — in every row', () => {
    const html = render([
      draft({ key: 1, partNumber: 'BRG-001', description: 'Bearing', quantity: '2' }),
      draft({ key: 2, partNumber: 'SK-010', description: 'Seal kit', quantity: '1' }),
    ]);
    expect(fieldOrder(html)).toEqual([
      'part-number',
      'description',
      'quantity',
      'part-number',
      'description',
      'quantity',
    ]);
    const labels = [...html.matchAll(/<label[^>]*>([^<]*)/gu)].map((match) => match[1]!.trim());
    expect(labels.slice(0, 3)).toEqual(['Part number', 'Description', 'Quantity']);
  });

  it('leaves the keyboard to the markup: no tabindex, no CSS reordering', () => {
    const html = render([draft({})]);
    expect(html).not.toMatch(/tabindex/iu);
    expect(html).not.toMatch(/\border-(first|last|\d)/u);
  });

  it('puts each value in its own field — never swapped', () => {
    const html = render([draft({ partNumber: 'BRG-001', description: 'Bearing', quantity: '2' })]);
    expect(html).toMatch(/<input[^>]*data-testid="repair-item-part-number" value="BRG-001"/u);
    expect(html).toMatch(/<input[^>]*data-testid="repair-item-description" value="Bearing"/u);
    expect(html).toMatch(/<input[^>]*data-testid="repair-item-quantity" value="2"/u);
  });

  it('stacks on a phone and gives the description the wide column from sm', () => {
    expect(render([draft({})])).toContain('grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_7rem]');
  });

  it('saves and reopens several parts unchanged, in order', () => {
    const items: readonly RepairItem[] = [
      { partNumber: 'BRG-001', description: 'Bearing', quantity: 2 },
      { partNumber: '', description: 'Coupling', quantity: null },
      { partNumber: 'SNS-004', description: 'Sensor', quantity: 3 },
    ];
    expect(repairItemsFromDrafts(repairItemDrafts(items))).toEqual(items);
  });
});
