// Unit tests for multi-currency toIdr helper and FX rate logic.
// Follows RULES.md §3 (Rule 1 & Rule 2).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fx from '../server/lib/fxProvider.js'

test('toIdr: identity conversion for IDR', async () => {
  const res = await fx.toIdr(1500000, 'IDR', '2026-10-04')
  assert.equal(res.amount_idr, 1500000)
  assert.equal(res.booked_rate, '1')
  assert.equal(res.rate_source, 'identity')
  assert.equal(res.rate_effective_date, '2026-10-04')
})

test('toIdr: conversion for USD, EUR, SGD, USDT', async () => {
  const usd = await fx.toIdr(100, 'USD', '2026-10-04')
  assert.equal(usd.amount_idr, 1630000)
  assert.equal(usd.booked_rate, '16300')

  const eur = await fx.toIdr(50, 'EUR', '2026-10-04')
  assert.equal(eur.amount_idr, 890000)
  assert.equal(eur.booked_rate, '17800')

  const sgd = await fx.toIdr(200, 'SGD', '2026-10-04')
  assert.equal(sgd.amount_idr, 2500000)
  assert.equal(sgd.booked_rate, '12500')

  const usdt = await fx.toIdr(1000, 'USDT', '2026-10-04')
  assert.equal(usdt.amount_idr, 16290000)
  assert.equal(usdt.booked_rate, '16290')
})

test('toIdr: audited manual rate override', async () => {
  const manual = await fx.toIdr(100, 'USD', '2026-10-04', {
    rate: '16450',
    reason: 'Bank Mandiri counter rate slip',
    actor: 1057134807,
  })
  assert.equal(manual.amount_idr, 1645000)
  assert.equal(manual.booked_rate, '16450')
  assert.equal(manual.rate_source, 'manual')
  assert.equal(manual.manual_reason, 'Bank Mandiri counter rate slip')
})

test('toIdr: handles decimal amounts gracefully', async () => {
  const res = await fx.toIdr(12.50, 'USD', '2026-10-04')
  assert.equal(res.amount_idr, 203750) // 12.5 * 16300 = 203750
})

test('getTodayRate: returns synchronous valuation rates', () => {
  assert.equal(fx.getTodayRate('IDR'), 1)
  assert.equal(fx.getTodayRate('USD'), 16300)
  assert.equal(fx.getTodayRate('EUR'), 17800)
  assert.equal(fx.getTodayRate('SGD'), 12500)
  assert.equal(fx.getTodayRate('USDT'), 16290)
})

test('toIdr: rejects invalid amounts', async () => {
  await assert.rejects(async () => fx.toIdr('not-a-number', 'USD'), /invalid_amount/)
})

test('buildTransferLegs: same-currency transfer creates 2 balanced legs', async () => {
  const w1 = { id: 'w-idr-1', name: 'BCA IDR', currency: 'IDR' }
  const w2 = { id: 'w-idr-2', name: 'Mandiri IDR', currency: 'IDR' }
  const res = await fx.buildTransferLegs({
    sourceWallet: w1,
    targetWallet: w2,
    sourceAmount: 5000000,
    transactionDate: '2026-10-04',
  })
  assert.equal(res.sourceLeg.type, 'expense')
  assert.equal(res.sourceLeg.amount_original, 5000000)
  assert.equal(res.sourceLeg.amount_idr, 5000000)
  assert.equal(res.sourceLeg.currency_original, 'IDR')

  assert.equal(res.targetLeg.type, 'income')
  assert.equal(res.targetLeg.amount_original, 5000000)
  assert.equal(res.targetLeg.amount_idr, 5000000)
  assert.equal(res.targetLeg.currency_original, 'IDR')

  assert.equal(res.conversion, null)
  assert.equal(res.fxDeltaIdr, 0)
})

test('buildTransferLegs: cross-currency transfer creates 2 legs and records FX difference', async () => {
  const wUsd = { id: 'w-usd-1', name: 'Wise USD', currency: 'USD' }
  const wIdr = { id: 'w-idr-1', name: 'BCA IDR', currency: 'IDR' }
  // Transfer $1,000 USD to IDR, bank credited Rp 16,250,000 (market quote is 16,300,000 -> 50,000 spread/fee)
  const res = await fx.buildTransferLegs({
    sourceWallet: wUsd,
    targetWallet: wIdr,
    sourceAmount: 1000,
    targetAmount: 16250000,
    transactionDate: '2026-10-04',
  })
  assert.equal(res.sourceLeg.amount_original, 1000)
  assert.equal(res.sourceLeg.currency_original, 'USD')
  assert.equal(res.sourceLeg.amount_idr, 16300000) // $1000 * 16300
  assert.equal(res.sourceLeg.booked_rate, '16300')

  assert.equal(res.targetLeg.amount_original, 16250000)
  assert.equal(res.targetLeg.currency_original, 'IDR')
  assert.equal(res.targetLeg.amount_idr, 16250000)

  assert.ok(res.conversion)
  assert.equal(res.conversion.source_asset, 'USD')
  assert.equal(res.conversion.target_asset, 'IDR')
  assert.equal(res.fxDeltaIdr, -50000) // Rp 50,000 loss/spread
  assert.equal(res.conversion.is_loss, true)
})

test('company cash valuation: mixed currency vs 100% IDR invariant', () => {
  // Case A: PT Helm Care Indonesia (100% IDR) — cash total must match exactly
  const helmCareWallets = [
    { name: 'BCA Operasional', currency: 'IDR', balance: 100000000 },
    { name: 'Mandiri Pajak', currency: 'IDR', balance: 31820000 },
  ]
  const helmCareTotal = helmCareWallets.reduce((s, w) => {
    const rate = fx.getTodayRate(w.currency)
    return s + (w.balance * rate)
  }, 0)
  assert.equal(helmCareTotal, 131820000) // Rp 131.82M unchanged

  // Case B: Mixed company with IDR, USD, EUR, SGD, USDT accounts
  const mixedWallets = [
    { name: 'BCA IDR', currency: 'IDR', balance: 50000000 },
    { name: 'Wise USD', currency: 'USD', balance: 5000 },     // 5000 * 16300 = 81,500,000
    { name: 'Revolut EUR', currency: 'EUR', balance: 2000 },  // 2000 * 17800 = 35,600,000
    { name: 'DBS SGD', currency: 'SGD', balance: 4000 },      // 4000 * 12500 = 50,000,000
    { name: 'Bitget USDT', currency: 'USDT', balance: 1000 }, // 1000 * 16290 = 16,290,000
  ]
  const mixedTotal = mixedWallets.reduce((s, w) => {
    const rate = fx.getTodayRate(w.currency)
    return s + Math.round(w.balance * rate)
  }, 0)
  // 50M + 81.5M + 35.6M + 50M + 16.29M = 233,390,000
  assert.equal(mixedTotal, 233390000)
})
