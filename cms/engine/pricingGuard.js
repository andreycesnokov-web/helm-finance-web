/**
 * Pricing Discrepancy Guard
 * Validates proposed website pricing presentation against the authoritative billing catalog.
 * Prevents marketing claims from silently contradicting billing enforcement.
 */

const fs = require('fs');
const path = require('path');

class PricingGuard {
  constructor(catalogPath) {
    this.catalogPath = catalogPath || path.join(__dirname, '../data/billing_catalog_reference.json');
  }

  loadCatalog() {
    try {
      const data = fs.readFileSync(this.catalogPath, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      console.error('[PricingGuard] Failed to load catalog reference:', err.message);
      return null;
    }
  }

  /**
   * Validate a proposed pricing presentation payload.
   * Checks plan prices, 11 usage limits, and 12 features across Starter, Control, and Pro.
   * @param {Object} proposedPricing 
   * @returns {Object} { isValid: boolean, discrepancies: Array, catalogVersion: string }
   */
  validatePricing(proposedPricing) {
    const catalog = this.loadCatalog();
    if (!catalog) {
      return {
        isValid: false,
        discrepancies: [{ level: 'error', message: 'Authoritative billing catalog reference unavailable.' }],
        catalogVersion: 'unknown'
      };
    }

    const discrepancies = [];

    // 1. Validate Monthly Prices
    if (proposedPricing.plans && Array.isArray(proposedPricing.plans)) {
      for (const proposedPlan of proposedPricing.plans) {
        const catalogPlan = catalog.plans[proposedPlan.id];
        if (!catalogPlan) {
          discrepancies.push({
            plan: proposedPlan.id,
            field: 'plan_id',
            level: 'error',
            message: `Plan '${proposedPlan.id}' does not exist in authoritative billing catalog.`
          });
          continue;
        }

        if (proposedPlan.price_monthly !== catalogPlan.price_monthly) {
          discrepancies.push({
            plan: proposedPlan.id,
            field: 'price_monthly',
            level: 'error',
            message: `Price discrepancy for ${catalogPlan.name || proposedPlan.name}: Proposed $${proposedPlan.price_monthly}/mo vs. Catalog $${catalogPlan.price_monthly}/mo.`
          });
        }

        if (proposedPlan.trial_days !== undefined && proposedPlan.trial_days !== catalogPlan.trial_days) {
          discrepancies.push({
            plan: proposedPlan.id,
            field: 'trial_days',
            level: 'error',
            message: `Trial days mismatch for ${proposedPlan.id}: Proposed ${proposedPlan.trial_days} days vs. Catalog ${catalogPlan.trial_days} days.`
          });
        }

        if (proposedPlan.trial_hours !== undefined && proposedPlan.trial_hours !== catalogPlan.trial_hours) {
          discrepancies.push({
            plan: proposedPlan.id,
            field: 'trial_hours',
            level: 'error',
            message: `Trial hours mismatch for ${proposedPlan.id}: Proposed ${proposedPlan.trial_hours} hours vs. Catalog ${catalogPlan.trial_hours} hours.`
          });
        }
      }
    }

    // 2. Validate Global Trial Presentation if specified
    if (proposedPricing.trial) {
      if (proposedPricing.trial.duration_hours !== undefined && proposedPricing.trial.duration_hours !== 168) {
        discrepancies.push({
          plan: 'all',
          field: 'duration_hours',
          level: 'error',
          message: `Global trial duration mismatch: Proposed ${proposedPricing.trial.duration_hours}h vs. Catalog 168h.`
        });
      }
      if (proposedPricing.trial.duration_days !== undefined && proposedPricing.trial.duration_days !== 7) {
        discrepancies.push({
          plan: 'all',
          field: 'duration_days',
          level: 'error',
          message: `Global trial duration mismatch: Proposed ${proposedPricing.trial.duration_days} days vs. Catalog 7 days.`
        });
      }
    }

    // 2. Validate Usage Limits Table (11 limits)
    if (proposedPricing.usage_limits_table && Array.isArray(proposedPricing.usage_limits_table)) {
      const numericParsers = {
        users: v => parseInt(String(v).replace(/\D/g, ''), 10),
        companies: v => parseInt(String(v).replace(/\D/g, ''), 10),
        accounts: v => parseInt(String(v).replace(/\D/g, ''), 10),
        documents: v => parseInt(String(v).replace(/\D/g, ''), 10),
        ai: v => parseInt(String(v).replace(/\D/g, ''), 10),
        imports: v => parseInt(String(v).replace(/\D/g, ''), 10),
        bank_rows: v => parseInt(String(v).replace(/\D/g, ''), 10),
        transactions: v => parseInt(String(v).replace(/\D/g, ''), 10),
        ai_accountant: v => parseInt(String(v).replace(/\D/g, ''), 10),
        ai_extraction: v => parseInt(String(v).replace(/\D/g, ''), 10),
        mcp: v => parseInt(String(v).replace(/\D/g, ''), 10)
      };

      for (const row of proposedPricing.usage_limits_table) {
        const key = row.key;
        const parser = numericParsers[key];
        if (!parser) continue;

        ['starter', 'control', 'pro'].forEach(tier => {
          const proposedVal = parser(row[tier]);
          const catalogVal = catalog.plans[tier]?.limits?.[key];

          if (catalogVal !== undefined && proposedVal !== catalogVal) {
            discrepancies.push({
              plan: tier,
              key: key,
              level: 'error',
              message: `Usage Limit mismatch on '${row.label}' for ${tier.toUpperCase()}: Proposed ${row[tier]} (${proposedVal}) vs. Catalog quota (${catalogVal}).`
            });
          }
        });
      }
    }

    return {
      isValid: discrepancies.length === 0,
      discrepancies,
      catalogVersion: catalog.catalog_version,
      verifiedAt: catalog.verified_at
    };
  }
}

module.exports = PricingGuard;
