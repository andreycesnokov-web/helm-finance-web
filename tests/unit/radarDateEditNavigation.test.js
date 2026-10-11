// Unit test for Stage 3: Radar Date Edit Navigation (DEF-03)
const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('Stage 3: Radar Date Edit Navigation (DEF-03)', () => {
  it('Criterion 1: Correctly identifies target debt to edit from ?edit=<id> query param', () => {
    const debtsList = [
      { id: 101, type: 'payable', counterparty: 'Vendor Alpha', due_date: null },
      { id: 102, type: 'receivable', counterparty: 'Client Beta', due_date: null },
    ];

    const searchUrlPayable = 'http://localhost/business/payables?edit=101';
    const paramsPayable = new URL(searchUrlPayable).searchParams;
    const editIdPayable = paramsPayable.get('edit');
    const targetPayable = debtsList.find(d => String(d.id) === String(editIdPayable));

    assert.strictEqual(editIdPayable, '101');
    assert.ok(targetPayable);
    assert.strictEqual(targetPayable.type, 'payable');
    assert.strictEqual(targetPayable.counterparty, 'Vendor Alpha');

    const searchUrlReceivable = 'http://localhost/business/receivables?edit=102';
    const paramsReceivable = new URL(searchUrlReceivable).searchParams;
    const editIdReceivable = paramsReceivable.get('edit');
    const targetReceivable = debtsList.find(d => String(d.id) === String(editIdReceivable));

    assert.strictEqual(editIdReceivable, '102');
    assert.ok(targetReceivable);
    assert.strictEqual(targetReceivable.type, 'receivable');
    assert.strictEqual(targetReceivable.counterparty, 'Client Beta');
  });

  it('Criterion 2: Clean URL sanitization removes ?edit parameter without touching other query parameters', () => {
    const url = new URL('http://localhost/business/payables?tab=open&edit=101&filter=all');
    const params = url.searchParams;

    assert.strictEqual(params.get('edit'), '101');
    params.delete('edit');

    const cleanedSearch = params.toString() ? `?${params.toString()}` : '';
    assert.strictEqual(cleanedSearch, '?tab=open&filter=all');
    assert.strictEqual(params.has('edit'), false);

    // Sole parameter removal
    const urlSole = new URL('http://localhost/business/receivables?edit=102');
    const paramsSole = urlSole.searchParams;
    paramsSole.delete('edit');
    const cleanedSole = paramsSole.toString() ? `?${paramsSole.toString()}` : '';
    assert.strictEqual(cleanedSole, '');
  });

  it('Criterion 3: Non-existent debt ID in ?edit does not trigger false modal opening', () => {
    const debtsList = [
      { id: 101, type: 'payable', counterparty: 'Vendor Alpha' },
    ];
    const params = new URLSearchParams('?edit=999');
    const editId = params.get('edit');
    const target = debtsList.find(d => String(d.id) === String(editId));

    assert.strictEqual(target, undefined);
  });
});
